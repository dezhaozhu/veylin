import { useAui } from '@assistant-ui/store';
import { composeEventHandlers } from '@radix-ui/primitive';
import { Slot } from 'radix-ui';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useState,
  type ReactElement,
} from 'react';
import { addComposerFiles } from '@/lib/add-composer-files';

type ComposerAttachmentDropzoneProps = React.HTMLAttributes<HTMLDivElement> & {
  asChild?: boolean;
  render?: ReactElement;
  disabled?: boolean;
};

/** Composer file drop target; sequential adds avoid attachment state races. */
export const ComposerAttachmentDropzone = forwardRef<
  HTMLDivElement,
  ComposerAttachmentDropzoneProps
>(({ disabled, asChild = false, render, children, ...rest }, ref) => {
  const [isDragging, setIsDragging] = useState(false);
  const aui = useAui();

  const handleDragEnterCapture = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      setIsDragging(true);
    },
    [disabled],
  );

  const handleDragOverCapture = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      if (!isDragging) setIsDragging(true);
    },
    [disabled, isDragging],
  );

  const handleDragLeaveCapture = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      const next = e.relatedTarget as Node | null;
      if (next && e.currentTarget.contains(next)) return;
      setIsDragging(false);
    },
    [disabled],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      try {
        await addComposerFiles((file) => aui.composer().addAttachment(file), files);
      } catch (error) {
        console.error('Failed to add attachment:', error);
      }
    },
    [disabled, aui],
  );

  const mergedProps = {
    ...(isDragging ? { 'data-dragging': 'true' } : null),
    ...rest,
    onDragEnterCapture: composeEventHandlers(
      rest.onDragEnterCapture,
      handleDragEnterCapture,
    ),
    onDragOverCapture: composeEventHandlers(rest.onDragOverCapture, handleDragOverCapture),
    onDragLeaveCapture: composeEventHandlers(
      rest.onDragLeaveCapture,
      handleDragLeaveCapture,
    ),
    onDropCapture: composeEventHandlers(rest.onDropCapture, handleDrop),
    ref,
  };

  if (render && isValidElement(render)) {
    const renderChildren =
      children !== undefined
        ? children
        : (render.props as Record<string, unknown>).children;
    return (
      <Slot.Root {...mergedProps}>
        {cloneElement(render, undefined, renderChildren as React.ReactNode)}
      </Slot.Root>
    );
  }

  const Comp = asChild ? Slot.Root : 'div';
  return <Comp {...mergedProps}>{children}</Comp>;
});

ComposerAttachmentDropzone.displayName = 'ComposerAttachmentDropzone';
