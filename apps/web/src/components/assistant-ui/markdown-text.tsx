"use client";

import "@assistant-ui/react-markdown/styles/dot.css";
import "katex/dist/katex.min.css";

import {
  type CodeHeaderProps,
  escapeCurrencyDollars,
  MarkdownTextPrimitive,
  normalizeMathDelimiters,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
  type SyntaxHighlighterProps,
} from "@assistant-ui/react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { type FC, memo, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { MermaidDiagram } from "@/components/assistant-ui/mermaid-diagram";
import { CitationMarkdownLink } from "@/components/assistant-ui/citation-markdown-link";
import { SyntaxHighlighter } from "@/components/assistant-ui/shiki-highlighter";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { remarkCallouts } from "@/lib/remark-callouts";
import { remarkInlineCitations } from "@/lib/remark-inline-citations";
import { cn } from "@/lib/utils";

/** assistant-ui official LaTeX path: normalize \( \)/\[ \] then protect $5 currency. */
const preprocessMarkdownMath = (text: string) =>
  escapeCurrencyDollars(normalizeMathDelimiters(text));

const rehypeKatexPlugins: [[typeof rehypeKatex, { throwOnError: boolean }]] = [
  [rehypeKatex, { throwOnError: false }],
];

const baseRemarkPlugins = [remarkGfm, remarkMath, remarkDirective, remarkCallouts];

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={baseRemarkPlugins}
      rehypePlugins={rehypeKatexPlugins}
      preprocess={preprocessMarkdownMath}
      className="aui-md"
      components={defaultComponents}
      componentsByLanguage={markdownComponentsByLanguage}
      defer
    />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const AssistantMarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[...baseRemarkPlugins, remarkInlineCitations]}
      rehypePlugins={rehypeKatexPlugins}
      preprocess={preprocessMarkdownMath}
      className="aui-md"
      components={assistantComponents}
      componentsByLanguage={markdownComponentsByLanguage}
      defer
    />
  );
};

export const AssistantMarkdownText = memo(AssistantMarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };
  const languageLabel =
    language && language !== "unknown" ? language : null;

  return (
    <div className="aui-code-header-root border-border/50 bg-muted/50 mt-3 flex items-center justify-between rounded-t-xl border border-b-0 px-3.5 py-1.5 text-xs">
      <span className="aui-code-header-language text-muted-foreground font-medium lowercase">
        {languageLabel}
      </span>
      <TooltipIconButton tooltip="Copy" onClick={onCopy}>
        {!isCopied && (
          <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
        )}
        {isCopied && (
          <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
        )}
      </TooltipIconButton>
    </div>
  );
};

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copyToClipboardValue = async (value: string) => {
    if (!value || isCopied) return;
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setIsCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsCopied(false), copiedDuration);
  };

  return { isCopied, copyToClipboard: copyToClipboardValue };
};

const MermaidSyntaxHighlighter: FC<SyntaxHighlighterProps> = ({ code }) => (
  <MermaidDiagram code={code} />
);

const MermaidCodeHeader: FC<CodeHeaderProps> = () => null;

const markdownComponentsByLanguage = {
  mermaid: {
    SyntaxHighlighter: MermaidSyntaxHighlighter,
    CodeHeader: MermaidCodeHeader,
  },
} as const;

const defaultComponents = memoizeMarkdownComponents({
  SyntaxHighlighter,
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "aui-md-h1 mt-5 mb-2 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  div: ({ className, children, ...props }) => {
    const callout =
      typeof (props as { "data-callout"?: unknown })["data-callout"] === "string"
        ? String((props as { "data-callout": string })["data-callout"])
        : null;
    if (!callout) {
      return (
        <div className={className} {...props}>
          {children}
        </div>
      );
    }
    const title =
      typeof (props as { "data-title"?: unknown })["data-title"] === "string"
        ? String((props as { "data-title": string })["data-title"])
        : null;
    return (
      <div
        className={cn(
          "aui-md-callout my-3 rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed",
          callout === "tip" &&
            "border-emerald-500/25 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100",
          callout === "note" &&
            "border-sky-500/25 bg-sky-500/10 text-sky-950 dark:text-sky-100",
          callout === "info" &&
            "border-sky-500/25 bg-sky-500/10 text-sky-950 dark:text-sky-100",
          callout === "warning" &&
            "border-amber-500/25 bg-amber-500/10 text-amber-950 dark:text-amber-100",
          callout === "danger" &&
            "border-red-500/25 bg-red-500/10 text-red-950 dark:text-red-100",
          className,
        )}
        {...props}
      >
        {title ? (
          <div className="aui-md-callout-title mb-1 font-semibold">{title}</div>
        ) : null}
        {children}
      </div>
    );
  },
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "aui-md-h2 mt-5 mb-2 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "aui-md-h3 mt-4 mb-1.5 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "aui-md-h4 mt-3.5 mb-1 scroll-m-20 text-base font-medium first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn(
        "aui-md-h5 mt-3 mb-1 text-sm font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "aui-md-h6 mt-3 mb-1 text-sm font-medium first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn(
        "aui-md-p my-3 leading-relaxed first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "aui-md-a text-primary hover:text-primary/80 underline underline-offset-2",
        className,
      )}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "aui-md-blockquote border-muted-foreground/30 text-muted-foreground my-3 border-s-2 ps-4",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "aui-md-ul marker:text-muted-foreground my-3 ms-5 list-disc [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "aui-md-ol marker:text-muted-foreground my-3 ms-5 list-decimal [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn("aui-md-hr border-muted-foreground/20 my-3", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <table
      className={cn(
        "aui-md-table my-3 w-full border-separate border-spacing-0 overflow-y-auto",
        className,
      )}
      {...props}
    />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "aui-md-th bg-muted px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-muted-foreground/20 border-s border-b px-3 py-1.5 text-start last:border-e [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        "aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("aui-md-li leading-relaxed", className)} {...props} />
  ),
  strong: ({ className, ...props }) => (
    <strong
      className={cn("aui-md-strong font-semibold", className)}
      {...props}
    />
  ),
  sup: ({ className, ...props }) => (
    <sup
      className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)}
      {...props}
    />
  ),
  pre: function Pre({ className, children, ...props }) {
    return (
      <pre
        className={cn(
          "aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-t-none rounded-b-xl border border-t-0 p-3.5 text-[13px] leading-relaxed",
          className,
        )}
        {...props}
      >
        {children}
      </pre>
    );
  },
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "aui-md-inline-code bg-muted rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      />
    );
  },
  CodeHeader,
});

const assistantComponents = memoizeMarkdownComponents({
  ...defaultComponents,
  a: ({ className, href, children, ...props }) => {
    if (href?.startsWith("rag-citation://")) {
      const refIndex = Number(href.slice("rag-citation://".length));
      if (Number.isFinite(refIndex) && refIndex > 0) {
        return <CitationMarkdownLink refIndex={refIndex}>{children}</CitationMarkdownLink>;
      }
    }
    return (
      <a
        className={cn(
          "aui-md-a text-primary hover:text-primary/80 underline underline-offset-2",
          className,
        )}
        href={href}
        {...props}
      >
        {children}
      </a>
    );
  },
});
