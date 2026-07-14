export function formatArtifactValidationMessage(message: string) {
  if (/category count|must match (?:the )?categor(?:y|ies)/i.test(message)) {
    return "One chart has a different number of values and categories. Ask your agent to correct the bundle and deliver the complete selection again.";
  }
  return message;
}
