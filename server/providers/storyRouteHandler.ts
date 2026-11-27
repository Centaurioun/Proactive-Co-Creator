import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { chatGptSessionStore } from '../auth/chatgpt/runtime.ts';
import { AppApiError } from '../errors.ts';
import type { ChatGptResponsesAdapter } from './chatgptResponses.ts';
import { hasSameOriginLocalRequest } from './localOriginGuard.ts';
import type { AiProviderRequestContext } from './requestContext.ts';
import { createChatGptAdapter } from './runtime.ts';
import type { ChatGptStorySrbAuthority } from './subscriptionResourceBudget.ts';

const CHATGPT_STORY_INSTRUCTIONS = 'Write a vivid, engaging, well-structured story based only on the supplied story brief and its creative constraints. Preserve confirmed details and exclusions. Return story text only.';

export interface ChatGptStorySrbInjection {
  authority: ChatGptStorySrbAuthority;
  currentGrantGeneration: () => number;
  adapterFactory: (generation: number) => Pick<ChatGptResponsesAdapter, 'generateStoryText'>;
}

export interface HandleChatGptStoryParams {
  req: Request;
  prompt: string;
  signal: AbortSignal;
  providerContext: AiProviderRequestContext;
  localActivation: boolean;
  localAuthority: ChatGptStorySrbAuthority;
  injection?: ChatGptStorySrbInjection;
}

export async function handleChatGptStoryGeneration(params: HandleChatGptStoryParams): Promise<{
  story: string;
  usage: { inputTokens?: number; outputTokens?: number; source?: 'provider-observed' | 'estimate' | 'unknown' };
}> {
  const { req, prompt, signal, providerContext, localActivation, localAuthority, injection } = params;
  if (localActivation && !hasSameOriginLocalRequest(req)) {
    throw new AppApiError('AUTH_ERROR', 'ChatGPT Story is available only from this local PCC browser origin.', 403, false);
  }
  const selectedModelId = providerContext.selection.modelId;
  if (!selectedModelId) {
    throw new AppApiError('MODEL_UNSUPPORTED', 'Select a current ChatGPT account model before using the story route.', 422, false);
  }
  const reasoningLevel = providerContext.selection.reasoningLevel ?? 'default';
  if (!localActivation && !injection) {
    throw new AppApiError('MODEL_UNSUPPORTED', 'ChatGPT story generation is not activated for production admission.', 422, false);
  }
  const requestId = req.get('x-pcc-story-request-id');
  if (!requestId) {
    throw new AppApiError('VALIDATION_ERROR', 'A stable identity is required for this explicit ChatGPT story action.', 400, false);
  }

  const authority = injection?.authority ?? localAuthority;
  const currentGrantGeneration = injection?.currentGrantGeneration ?? (() => chatGptSessionStore.getGeneration());
  const grantGeneration = currentGrantGeneration();
  const sourceDigest = createHash('sha256').update(`${CHATGPT_STORY_INSTRUCTIONS}\n${prompt}\n${reasoningLevel}`).digest('hex');
  const plan = authority.prepare({
    requestId,
    modelId: selectedModelId,
    reasoningLevel,
    grantGeneration,
    sourceDigest,
    sourceText: prompt,
    instructions: CHATGPT_STORY_INSTRUCTIONS,
  });

  const result = await authority.run({
    plan,
    currentGrantGeneration,
    signal,
    transport: ({ body, limits }, transportSignal) => {
      const adapter = injection?.adapterFactory(grantGeneration) ?? createChatGptAdapter(grantGeneration);
      return adapter.generateStoryText({
        requestId: plan.requestId,
        operation: 'story',
        modelId: plan.modelId,
        input: plan.sourceText,
        ...(plan.instructions ? { instructions: plan.instructions } : {}),
        reasoningLevel,
        maxInputBytes: limits.maxRequestBodyBytes,
        maxOutputBytes: limits.maxAcceptedOutputBytes,
        timeoutMs: limits.timeoutMs,
        signal: transportSignal,
      }, body, {
        maxStreamBytes: limits.maxStreamBytes,
        maxAcceptedOutputBytes: limits.maxAcceptedOutputBytes,
        maxStreamEvents: limits.maxStreamEvents,
      });
    },
  });

  if (result.terminalEvent !== 'response.completed' || result.refusal || !result.text.trim()) {
    throw new AppApiError('INVALID_RESPONSE', 'The ChatGPT story response did not contain accepted completed story text.', 502, false);
  }
  return { story: result.text, usage: result.usage ?? { source: 'unknown' } };
}
