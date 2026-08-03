"use client";

import {
  type PropsWithChildren,
  useEffect,
  useState,
  type FC,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { XIcon, PlusIcon, FileText } from "lucide-react";
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useAuiState,
  useAui,
} from "@assistant-ui/react";
import { useShallow } from "zustand/shallow";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { FileIcon } from "@react-symbols/icons/utils";
import { cn } from "@/lib/utils";
import { useChatColumnBounds } from "@/lib/overlay-bounds";

function fileTypeLabel(name: string, contentType?: string): string {
  if (contentType === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
    return "PDF";
  }
  const ext = name.split(".").pop()?.toUpperCase();
  return ext || "FILE";
}

const useFileSrc = (file: File | undefined) => {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return src;
};

const useAttachmentSrc = () => {
  const { file, src } = useAuiState(
    useShallow((s): { file?: File; src?: string } => {
      if (s.attachment.type !== "image") return {};
      if (s.attachment.file) return { file: s.attachment.file };
      const src = s.attachment.content?.filter((c) => c.type === "image")[0]
        ?.image;
      if (!src) return {};
      return { src };
    }),
  );

  return useFileSrc(file) ?? src;
};

type AttachmentPreviewProps = {
  src: string;
};

const AttachmentPreview: FC<AttachmentPreviewProps> = ({ src }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <img
      src={src}
      alt="Attachment preview"
      className={cn(
        "block h-auto max-h-[80vh] w-auto max-w-full object-contain",
        isLoaded
          ? "aui-attachment-preview-image-loaded"
          : "aui-attachment-preview-image-loading invisible",
      )}
      onLoad={() => setIsLoaded(true)}
    />
  );
};

/**
 * Image preview scoped to the chat column.
 * Native right-panel webviews paint above HTML, so a full-window dialog would
 * either be clipped by the page or force us to hide the webview (white flash).
 * Clipping the overlay to the chat inset keeps the webpage visible and normal.
 * Bounds track sidebar drag/collapse via ResizeObserver + transitionend.
 */
const AttachmentPreviewDialog: FC<PropsWithChildren> = ({ children }) => {
  const src = useAttachmentSrc();
  const [open, setOpen] = useState(false);
  const bounds = useChatColumnBounds(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!src) return children;

  const overlay =
    open && bounds
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Image Attachment Preview"
            className="fixed z-[201] flex items-center justify-center bg-black/50 p-4"
            style={{
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
            }}
            onClick={() => setOpen(false)}
          >
            <div
              className="bg-background relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-lg border p-2 shadow-lg"
              onClick={(event: MouseEvent) => event.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Close"
                className="bg-foreground/60 text-background hover:[&_svg]:text-destructive absolute top-2 right-2 z-10 rounded-full p-1 opacity-100 ring-0"
                onClick={() => setOpen(false)}
              >
                <XIcon className="size-4" />
              </button>
              <AttachmentPreview src={src} />
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        className="aui-attachment-preview-trigger contents cursor-pointer"
        onClick={() => setOpen(true)}
      >
        {children}
      </span>
      {overlay}
    </>
  );
};

const AttachmentThumb: FC = () => {
  const src = useAttachmentSrc();

  return (
    <Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none">
      <AvatarImage
        src={src}
        alt="Attachment preview"
        className="aui-attachment-tile-image object-cover"
      />
      <AvatarFallback>
        <FileText className="aui-attachment-tile-fallback-icon text-muted-foreground size-8" />
      </AvatarFallback>
    </Avatar>
  );
};

const AttachmentRemove: FC<{ className?: string; variant?: "dark" | "light" }> = ({
  className,
  variant = "dark",
}) => {
  return (
    <AttachmentPrimitive.Remove asChild>
      <button
        type="button"
        aria-label="Remove file"
        className={cn(
          "aui-attachment-tile-remove flex shrink-0 items-center justify-center rounded-full shadow-sm transition-opacity hover:opacity-80",
          variant === "dark"
            ? "bg-black text-white"
            : "bg-white text-black",
          className,
        )}
      >
        <XIcon className="aui-attachment-remove-icon size-2.5 stroke-[2.5px]" />
      </button>
    </AttachmentPrimitive.Remove>
  );
};

const DocumentAttachmentCard: FC = () => {
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";
  const name = useAuiState((s) => s.attachment.name);
  const contentType = useAuiState((s) => s.attachment.contentType);
  const typeLabel = fileTypeLabel(name, contentType);

  return (
    <AttachmentPrimitive.Root className="aui-attachment-root aui-attachment-root-document relative w-44 shrink-0">
      <div
        className="aui-attachment-document-card relative flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-border/70 bg-background px-2.5 py-2 pe-8 shadow-sm"
        aria-label={`${typeLabel} attachment: ${name}`}
      >
        <div className="aui-attachment-document-icon flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/60">
          <FileIcon
            fileName={name}
            autoAssign
            width={20}
            height={20}
            className="shrink-0"
            aria-hidden
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="aui-attachment-document-meta min-w-0 flex-1 basis-0 overflow-hidden">
              <p
                className="aui-attachment-document-name block w-full truncate text-sm leading-tight text-foreground"
                title={name}
              >
                {name}
              </p>
              <p className="aui-attachment-document-type text-muted-foreground mt-0.5 truncate text-xs leading-none">
                {typeLabel}
              </p>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs break-all">
            {name}
          </TooltipContent>
        </Tooltip>
        {isComposer && (
          <AttachmentRemove className="absolute end-1.5 top-1.5 size-5" />
        )}
      </div>
    </AttachmentPrimitive.Root>
  );
};

const ImageAttachmentTile: FC = () => {
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";
  const typeLabel = useAuiState((s) => {
    const type = s.attachment.type;
    switch (type) {
      case "image":
        return "Image";
      case "document":
        return "Document";
      case "file":
        return "File";
      default:
        return type;
    }
  });

  return (
    <Tooltip>
      <AttachmentPrimitive.Root
        className={cn(
          "aui-attachment-root relative shrink-0",
          !isComposer && "aui-attachment-root-message only:*:first:size-24",
        )}
      >
        <AttachmentPreviewDialog>
          <TooltipTrigger asChild>
            <div
              className="aui-attachment-tile bg-muted size-14 cursor-pointer overflow-hidden rounded-[calc(var(--composer-radius)-var(--composer-padding))] border transition-opacity hover:opacity-75"
              role="button"
              tabIndex={0}
              aria-label={`${typeLabel} attachment`}
            >
              <AttachmentThumb />
            </div>
          </TooltipTrigger>
        </AttachmentPreviewDialog>
        {isComposer && (
          <AttachmentRemove
            variant="light"
            className="absolute end-1.5 top-1.5 size-3.5"
          />
        )}
      </AttachmentPrimitive.Root>
      <TooltipContent side="top">
        <AttachmentPrimitive.Name />
      </TooltipContent>
    </Tooltip>
  );
};

export const AttachmentUI: FC = () => {
  const isDocument = useAuiState(
    (s) => s.attachment.type === "document" || s.attachment.type === "file",
  );

  if (isDocument) return <DocumentAttachmentCard />;
  return <ImageAttachmentTile />;
};

export const UserMessageAttachments: FC = () => {
  return (
    <div className="aui-user-message-attachments-end flex w-full flex-row flex-nowrap justify-end gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <MessagePrimitive.Attachments>
        {() => <AttachmentUI />}
      </MessagePrimitive.Attachments>
    </div>
  );
};

export const ComposerAttachments: FC = () => {
  return (
    <div className="aui-composer-attachments flex w-full flex-row flex-nowrap items-center gap-2 overflow-x-auto empty:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ComposerPrimitive.Attachments>
        {() => <AttachmentUI />}
      </ComposerPrimitive.Attachments>
    </div>
  );
};

export const ComposerAddAttachment: FC = () => {
  return (
    <ComposerPrimitive.AddAttachment asChild>
      <TooltipIconButton
        tooltip="Add Attachment"
        side="bottom"
        variant="ghost"
        size="icon"
        className="aui-composer-add-attachment hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30 size-7 rounded-full p-1 text-xs font-semibold"
        aria-label="Add Attachment"
      >
        <PlusIcon className="aui-attachment-add-icon size-4.5 stroke-[1.5px]" />
      </TooltipIconButton>
    </ComposerPrimitive.AddAttachment>
  );
};
