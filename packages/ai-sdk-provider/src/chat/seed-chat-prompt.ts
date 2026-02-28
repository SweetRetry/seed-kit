// export type MistralPrompt = Array<MistralMessage>;
export type SeedChatPrompt = Array<SeedChatMessage>;

export type SeedChatMessage =
  | SeedChatSystemMessage
  | SeedChatUserMessage
  | SeedChatAssistantMessage
  | SeedChatToolMessage;

export interface SeedChatSystemMessage {
  role: 'system';
  content: string;
}

export interface SeedChatUserMessage {
  role: 'user';
  content: Array<SeedChatUserMessageContent>;
}

export type SeedChatUserMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' } }
  | { type: 'video_url'; video_url: { url: string; fps?: number } }
  | { type: 'input_file'; file_url: string }
  | { type: 'input_file'; file_data: string; filename: string };

export interface SeedChatAssistantMessage {
  role: 'assistant';
  reasoning_content?: string;
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface SeedChatToolMessage {
  role: 'tool';
  content: string;
  tool_call_id: string;
}
