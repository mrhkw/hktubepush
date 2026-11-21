export const SUPPORTED_FILE_EXTENSIONS = ["pdf", "docx", "xlsx", "csv", "json", "md", "txt"] as const;
export type SupportedFileExtension = (typeof SUPPORTED_FILE_EXTENSIONS)[number];
export function isSupportedFile(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase();
  return !!extension && SUPPORTED_FILE_EXTENSIONS.includes(extension as SupportedFileExtension);
}
export function getFileAnalysisPrompt(fileName: string, extractedText: string): string {
  return "Analyze the following user-selected file: " + fileName + "\nDo not assume content that is not present. Provide: (1) concise summary, (2) key facts, (3) action items, (4) risks or inconsistencies, and (5) unanswered questions.\n\nFILE CONTENT:\n" + extractedText.slice(0, 30000);
}
