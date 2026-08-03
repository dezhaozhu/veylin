#!/usr/bin/env node
"use strict";

/**
 * Stdio MCP server for the scheduling-optimizer plugin.
 * Tools: validate_instance, solve_schedule.
 * Spawns plugin .venv Python (or python3) to run scripts/.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const SCRIPTS = path.join(PLUGIN_ROOT, "scripts");

function pythonBin() {
  const win = process.platform === "win32";
  const venvPy = win
    ? path.join(PLUGIN_ROOT, ".venv", "Scripts", "python.exe")
    : path.join(PLUGIN_ROOT, ".venv", "bin", "python");
  if (fs.existsSync(venvPy)) return venvPy;
  return win ? "python" : "python3";
}

function runPython(scriptName, inputJson) {
  return new Promise((resolve, reject) => {
    const script = path.join(SCRIPTS, scriptName);
    const child = spawn(pythonBin(), [script], {
      cwd: PLUGIN_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: SCRIPTS + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ""),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const text = stdout.trim();
      if (!text) {
        reject(new Error(stderr.trim() || `python exited ${code} with empty stdout`));
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(
          new Error(
            `invalid JSON from ${scriptName}: ${err instanceof Error ? err.message : String(err)}; stderr=${stderr}`,
          ),
        );
      }
    });
    child.stdin.write(typeof inputJson === "string" ? inputJson : JSON.stringify(inputJson));
    child.stdin.end();
  });
}

function toolDefinitions() {
  return [
    {
      name: "validate_instance",
      description:
        "Validate a scheduling instance JSON (jobs, operations, resources, objective, optional frozen, preferences, replan_window+baseline_schedule). Returns ok/errors/summary. Call only after the user confirmed which table columns map to calculation fields.",
      inputSchema: {
        type: "object",
        properties: {
          instance: {
            type: "object",
            description:
              "Scheduling instance object (may include preferences, replan_window, baseline_schedule, frozen)",
          },
          instance_json: {
            type: "string",
            description: "Scheduling instance as a JSON string (alternative to instance)",
          },
        },
      },
    },
    {
      name: "solve_schedule",
      description:
        "Solve with OR-Tools CP-SAT. Returns schedule, metrics (makespan, tardy_jobs, utilization, avg_flow_time), and auto_frozen_operation_ids when replan_window is set. Soft preferences (prefer_resource, prefer_earlier) never override hard feasibility/primary objective. Do not invent schedules by hand. Do not call before column-mapping confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          instance: {
            type: "object",
            description:
              "Scheduling instance; optional preferences, replan_window+baseline_schedule for local replan",
          },
          instance_json: {
            type: "string",
            description: "Scheduling instance as a JSON string (alternative to instance)",
          },
        },
      },
    },
  ];
}

function parseInstance(args) {
  if (args && typeof args.instance === "object" && args.instance !== null) {
    return args.instance;
  }
  if (typeof args?.instance_json === "string" && args.instance_json.trim()) {
    return JSON.parse(args.instance_json);
  }
  throw new Error("provide instance (object) or instance_json (string)");
}

async function callTool(name, args) {
  const instance = parseInstance(args ?? {});
  if (name === "validate_instance") {
    return runPython("validate_instance.py", instance);
  }
  if (name === "solve_schedule") {
    return runPython("solve_schedule.py", instance);
  }
  throw new Error(`unknown tool: ${name}`);
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function textContent(obj) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj,
  };
}

async function handleMessage(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "scheduling-optimizer-solver", version: "0.1.0" },
    });
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }
  if (method === "ping") {
    return rpcResult(id, {});
  }
  if (method === "tools/list") {
    return rpcResult(id, { tools: toolDefinitions() });
  }
  if (method === "tools/call") {
    const toolName = params?.name;
    try {
      const result = await callTool(toolName, params?.arguments ?? {});
      return rpcResult(id, textContent(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return rpcResult(id, {
        content: [{ type: "text", text: message }],
        isError: true,
      });
    }
  }
  if (id === undefined || id === null) return null;
  return rpcError(id, -32601, `Method not found: ${method}`);
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const response = await handleMessage(msg);
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
