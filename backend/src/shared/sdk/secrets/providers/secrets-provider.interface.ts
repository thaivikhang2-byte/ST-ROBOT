// ═══════════════════════════════════════════
// Secrets SDK — Provider Interface
// ═══════════════════════════════════════════

export interface ISecretsProvider {
  readonly name: string;
  get(key: string): Promise<string | undefined>;
  has(key: string): Promise<boolean>;
}
