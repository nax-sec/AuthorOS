export class AuthorOsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorOsError';
  }
}

export function validateProjectName(projectName: string | undefined): string {
  const cleaned = projectName?.trim();

  if (!cleaned) {
    throw new AuthorOsError('Project name is required. Example: author init "我的小说"');
  }

  return cleaned;
}

export function validateTemplate(template: string, supportedTemplateKeys: readonly string[]): string {
  const cleaned = template.trim();

  if (!supportedTemplateKeys.includes(cleaned)) {
    throw new AuthorOsError(
      `Unsupported template "${template}". Supported templates: ${supportedTemplateKeys.join(', ')}`,
    );
  }

  return cleaned;
}
