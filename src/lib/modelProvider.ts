// Model provider abstraction (frontend-safe type definitions).
// The actual provider implementation lives in each edge function since
// edge functions cannot share code. This module defines the interface
// and configuration so the frontend can display model info and the
// scoring module can validate responses.

export type ModelRole = 'worker' | 'reviewer';

export interface ModelConfig {
  provider: string;
  model: string;
  apiKeyEnvVar: string;
  baseUrl?: string;
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ModelCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object' | 'text';
}

export interface ModelCompletionResponse {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse>;
}

// Default configuration — can be overridden by environment variables.
// For initial development, one provider is implemented while preserving the abstraction.
export const MODEL_CONFIGS: Record<ModelRole, ModelConfig> = {
  worker: {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    apiKeyEnvVar: 'OPENAI_API_KEY',
  },
  reviewer: {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    apiKeyEnvVar: 'OPENAI_API_KEY',
  },
};
