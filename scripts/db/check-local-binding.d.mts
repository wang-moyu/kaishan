export const D1_BINDING_NAME: string;
export const LOCAL_DATABASE_ID: string;

export interface D1BindingDeclaration {
  binding?: string;
  database_name?: string;
  database_id?: string;
  migrations_dir?: string;
  remote?: boolean;
  experimental_remote?: boolean;
}

export interface WranglerConfig {
  d1_databases?: D1BindingDeclaration[];
  [key: string]: unknown;
}

export function stripJsonComments(text: string): string;
export function parseJsonc(text: string): unknown;
export function loadWranglerConfig(configPath: string): WranglerConfig;
export function assertLocalD1Binding(
  config: WranglerConfig | unknown,
  configPath: string,
): D1BindingDeclaration;
export function run(argv: string[]): number;
