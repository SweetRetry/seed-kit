import {
  Experimental_VideoModelV3,
  ImageModelV3,
  LanguageModelV3,
  NoSuchModelError,
  ProviderV3,
} from '@ai-sdk/provider';
import {
  FetchFunction,
  loadApiKey,
  withUserAgentSuffix,
  withoutTrailingSlash,
} from '@ai-sdk/provider-utils';
import { VERSION } from './version';
import { SeedChatLanguageModel, SeedModelId } from './chat';
import { SeedImageModel, SeedImageModelId } from './image';
import {
  SeedResponsesLanguageModel,
  SeedResponsesModelId,
} from './responses';
import { SeedVideoModel, SeedVideoModelId } from './video';

export interface SeedProviderSettings {
  /**
Use a different URL prefix for API calls, e.g. to use proxy servers.
The default prefix is `https://ark.cn-beijing.volces.com/api/v3`.
   */
  baseURL?: string;

  /**
API key that is sent using the `Authorization` header.
It defaults to the `ARK_API_KEY` environment variable.
   */
  apiKey?: string;

  /**
Custom headers to include in the requests.
   */
  headers?: Record<string, string>;

  /**
Custom fetch implementation. You can use it as a middleware to intercept requests,
or to provide a custom fetch implementation for e.g. testing.
   */
  fetch?: FetchFunction;
}

export interface SeedProvider extends ProviderV3 {
  (modelId: SeedResponsesModelId): LanguageModelV3;

  /**
Creates a model for text generation using the Responses API.
*/
  languageModel(modelId: SeedResponsesModelId): LanguageModelV3;

  /**
Creates a model for text generation using the Chat Completions API.
*/
  chat(modelId: SeedModelId): LanguageModelV3;

  /**
Creates a model for text generation using the Responses API.
*/
  responses(modelId: SeedResponsesModelId): LanguageModelV3;

  /**
Creates a model for image generation.
*/
  imageModel(modelId: SeedImageModelId): ImageModelV3;

  /**
Creates a model for video generation (Seedance series).
*/
  videoModel(modelId: SeedVideoModelId): Experimental_VideoModelV3;

  /**
Creates a model for text embeddings.
*/
  embeddingModel(modelId: SeedModelId): never;
}

/**
Create a Seed provider instance.
 */
export function createSeed(
  options: SeedProviderSettings = {},
): SeedProvider {
  const baseURL =
    withoutTrailingSlash(options.baseURL) ??
    'https://ark.cn-beijing.volces.com/api/v3';

  const getHeaders = () =>
    withUserAgentSuffix(
      {
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: 'ARK_API_KEY',
          description: 'Seed',
        })}`,
        ...options.headers,
      },
      `ai-sdk/seed/${VERSION}`,
    );

  const createChatModel = (modelId: string) =>
    new SeedChatLanguageModel(modelId, {
      provider: 'seed.chat',
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const createImageModel = (modelId: string) =>
    new SeedImageModel(modelId, {
      provider: 'seed.image',
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const createResponsesModel = (modelId: string) =>
    new SeedResponsesLanguageModel(modelId, {
      provider: 'seed.responses',
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const createVideoModel = (modelId: string) =>
    new SeedVideoModel(modelId, {
      provider: 'seed.video',
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const provider = function (modelId: SeedResponsesModelId) {
    return createResponsesModel(modelId);
  };

  provider.specificationVersion = 'v3' as const;
  provider.languageModel = createResponsesModel;
  provider.chat = createChatModel;
  provider.responses = createResponsesModel;
  provider.imageModel = createImageModel;
  provider.videoModel = createVideoModel;
  provider.embeddingModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
  };

  return provider as SeedProvider;
}

/**
Default Seed provider instance.
 */
export const seed = createSeed();
