import { DEFAULT_MODEL, getModelConfig } from '@veylin/runtime';
import { insertEntity, insertRelates } from '@veylin/db';
import { applyTenantModelSettings } from './model-settings-store';

type ExtractedEntity = { name: string; type: string };
type ExtractedEdge = { from: string; to: string; relation: string };

const STOP_PHRASES = new Set([
  '因为',
  '存在',
  '需要',
  '本周',
  '一次',
  '优先',
  '处理',
  '的维护',
  '的维护周期',
]);

function cleanEntityName(value: string): string {
  return value
    .replace(/[，。；;:：,.!?！？()[\]{}]/g, '')
    .replace(/^(因为|由于|存在|本周|需要|要|优先|处理)/, '')
    .replace(/^(需要|要)?优先处理/, '')
    .replace(/^的/, '')
    .replace(/^工单(?=WO[-_A-Z0-9])/i, '')
    .trim();
}

function inferEntityType(name: string): string {
  if (/^WO[-_A-Z0-9]+$/i.test(name) || /^工单/.test(name)) return 'work_order';
  if (/风险|延期|逾期/.test(name)) return 'risk';
  if (/设备|机台|产线/.test(name)) return 'equipment';
  if (/车间|资源|CNC|注塑|冲压|焊接|装配/.test(name)) return 'resource';
  if (/齿轮箱|产品|物料|零件/.test(name)) return 'product';
  if (/周期|维护|保养/.test(name)) return 'maintenance';
  return 'concept';
}

function relationForSentence(sentence: string, from: ExtractedEntity, to: ExtractedEntity): string {
  if (from.type === 'work_order' && to.type === 'risk') return 'has_risk';
  if (from.type === 'work_order' && to.type === 'resource') return 'uses_resource';
  if (from.type === 'equipment' && to.type === 'maintenance') return 'has_cycle';
  if (/优先|需要/.test(sentence)) return 'prioritizes';
  if (/因为|导致|由于/.test(sentence)) return 'caused_by';
  return 'mentions';
}

function heuristicExtract(text: string): { entities: ExtractedEntity[]; edges: ExtractedEdge[] } {
  const byName = new Map<string, ExtractedEntity>();
  const sentenceEntityGroups: { sentence: string; entities: ExtractedEntity[] }[] = [];
  const sentences = text.split(/[\n。；;!?！？]+/).map((s) => s.trim()).filter(Boolean);

  function add(name: string): ExtractedEntity | null {
    const clean = cleanEntityName(name);
    if (!clean || clean.length < 2 || STOP_PHRASES.has(clean)) return null;
    if (/^WO$/i.test(clean) || /^CNC$/i.test(clean)) return null;
    if (/的|是每/.test(clean)) return null;
    if (/^[\u4e00-\u9fff]{8,}$/.test(clean) && !/(车间|资源|设备|工单|周期|风险|齿轮箱|产品)/.test(clean)) return null;
    const existing = byName.get(clean);
    if (existing) return existing;
    const entity = { name: clean, type: inferEntityType(clean) };
    byName.set(clean, entity);
    return entity;
  }

  for (const sentence of sentences) {
    const current: ExtractedEntity[] = [];
    const patterns = [
      /(?:工单)?(WO[-_A-Z0-9]+)/gi,
      /(?:设备|机台|产线)[A-Za-z0-9一二三四五六七八九十甲乙丙丁_-]*/g,
      /[A-Z]{2,}车间/g,
      /(?:[\u4e00-\u9fff]{1,4})?(?:车间|资源|设备|工单|周期|风险|齿轮箱|注塑|冲压|焊接|装配)/g,
      /(?:齿轮箱|设备|产品|物料)[A-Z0-9]+/g,
    ];
    for (const pattern of patterns) {
      for (const match of sentence.matchAll(pattern)) {
        const entity = add(match[1] ?? match[0]);
        if (entity && !current.some((e) => e.name === entity.name)) current.push(entity);
      }
    }
    if (/延期|逾期|风险/.test(sentence)) {
      const entity = add(sentence.includes('延期') ? '延期风险' : '风险');
      if (entity && !current.some((e) => e.name === entity.name)) current.push(entity);
    }
    if (/维护|保养|周期/.test(sentence)) {
      const entity = add('维护周期');
      if (entity && !current.some((e) => e.name === entity.name)) current.push(entity);
    }
    if (current.length > 0) sentenceEntityGroups.push({ sentence, entities: current });
  }

  const entities = [...byName.values()].slice(0, 16);
  const edges: ExtractedEdge[] = [];

  for (const { sentence, entities: group } of sentenceEntityGroups) {
    const primary = group.find((e) => e.type === 'work_order') ?? group[0];
    if (!primary) continue;
    for (const target of group) {
      if (target.name === primary.name) continue;
      const edge = {
        from: primary.name,
        to: target.name,
        relation: relationForSentence(sentence, primary, target),
      };
      if (!edges.some((e) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) {
        edges.push(edge);
      }
      if (edges.length >= 12) break;
    }
    if (edges.length >= 12) break;
  }
  return { entities, edges };
}

async function llmExtract(
  tenantId: string,
  text: string,
): Promise<{ entities: ExtractedEntity[]; edges: ExtractedEdge[] } | null> {
  await applyTenantModelSettings(tenantId);
  const cfg = getModelConfig(DEFAULT_MODEL);
  if (!cfg.apiKey) return null;
  const excerpt = text.slice(0, 4000);
  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.modelId,
        messages: [
          {
            role: 'system',
            content:
              'Extract knowledge graph entities and relations from the text. ' +
              'Return strict JSON: {"entities":[{"name":"...","type":"..."}],"edges":[{"from":"...","to":"...","relation":"..."}]} ' +
              'Max 10 entities and 8 edges. Use short relation labels.',
          },
          { role: 'user', content: excerpt },
        ],
        temperature: 0,
        max_tokens: 800,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      entities?: ExtractedEntity[];
      edges?: ExtractedEdge[];
    };
    return {
      entities: (parsed.entities ?? []).filter((e) => e.name?.trim()).slice(0, 12),
      edges: (parsed.edges ?? []).filter((e) => e.from && e.to && e.relation).slice(0, 10),
    };
  } catch {
    return null;
  }
}

export async function extractAndStoreGraph(
  tenantId: string,
  documentId: string,
  text: string,
): Promise<{ entities: number; edges: number }> {
  const extracted = (await llmExtract(tenantId, text)) ?? heuristicExtract(text);
  const nameToId = new Map<string, string>();

  for (const ent of extracted.entities) {
    const row = await insertEntity({
      tenantId,
      name: ent.name,
      type: ent.type || 'concept',
      documentId,
    });
    nameToId.set(ent.name, row.id);
  }

  let edgeCount = 0;
  for (const edge of extracted.edges) {
    const fromId = nameToId.get(edge.from);
    const toId = nameToId.get(edge.to);
    if (!fromId || !toId) continue;
    await insertRelates({
      tenantId,
      fromEntityId: fromId,
      toEntityId: toId,
      relation: edge.relation,
      documentId,
    });
    edgeCount += 1;
  }

  return { entities: nameToId.size, edges: edgeCount };
}
