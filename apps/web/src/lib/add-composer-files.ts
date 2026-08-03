/** Add multiple composer files without racing attachment state updates. */
export async function addComposerFiles(
  addAttachment: (file: File) => Promise<void>,
  files: FileList | File[],
): Promise<void> {
  for (const file of files) {
    await addAttachment(file);
  }
}
