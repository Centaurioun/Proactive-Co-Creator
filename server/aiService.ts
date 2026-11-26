/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ThinkingLevel, Type } from '@google/genai';
import { randomUUID } from 'node:crypto';
import type {
  BatchEditProposalResult,
  BeliefState,
  Clarification,
  ClarificationAnswer,
  GenerationMode,
  GraphUpdate,
  ImageGenerationResult,
} from '../shared/types.ts';
import {
  parseAndValidateBatchEditResponse,
  parseAndValidateBeliefGraph,
  parseAndValidateClarifications,
} from '../shared/schemas.ts';
import { AppApiError, classifyGeminiError } from './errors.ts';
import { getGeminiClient } from './geminiClient.ts';
import { GEMINI_MODELS } from './models.ts';
import { withRetry } from './retry.ts';
import { acquireAiSlot, AI_OPERATION_POLICIES, estimateTokensFromText, evaluateOperationBudget, reserveAggregateOperationUsage } from './aiBudget.ts';

const TEXT_TIMEOUT_MS = 45_000;
const IMAGE_TIMEOUT_MS = 60_000;
const TARGET_IMAGE_COUNT = 4;
const IMAGE_CONCURRENCY = 2;

function combineSignals(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new AppApiError('TIMEOUT', 'The AI request timed out.', 504, true));
  }, timeoutMs);

  const onExternalAbort = () => {
    controller.abort(
      externalSignal?.reason ?? new AppApiError('CANCELLED', 'The request was cancelled.', 499, false)
    );
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
  };
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onFatalError?: (error: unknown) => void,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let firstError: unknown;
  let hasError = false;

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (!hasError && nextIndex < tasks.length) {
      const idx = nextIndex++;
      try {
        results[idx] = await tasks[idx]();
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
          onFatalError?.(error);
        }
        throw error;
      }
    }
  });

  await Promise.allSettled(workers);
  if (hasError) throw firstError;
  return results;
}

export async function analyzeBeliefGraph(
  prompt: string,
  mode: GenerationMode,
  signal?: AbortSignal
): Promise<BeliefState> {
  const ai = getGeminiClient();

  let specificInstructions: string;
  if (mode === 'image') {
    specificInstructions = `
      - **The Image Entity:** Always include an entity named "The Image" (category: "scene"). Required Attributes: weather, location, time of day, atmosphere, camera angle, image style.
      - **Subjects & Characters:** Include Attributes: age, personality, role, clothing, expression, pose.
      - **Objects & Locations:** Include Attributes: color, material, shape, size, atmosphere, lighting.
    `;
  } else {
    specificInstructions = `
      - **The Story Entity:** Always include an entity named "The Story" (category: "scene"). Required Attributes: genre, tone, narrative_perspective, pacing, central_conflict, setting.
      - **Characters:** Include Attributes: personality, motivation, role, age, background, emotional_state.
      - **Locations / Objects / Events:** Include Attributes: atmosphere, significance, appearance, condition.
    `;
  }

  const generationPrompt = `
Analyze the prompt and generate a complete **Belief Graph** representing the story or scene.
Identify all entities, their category ("character", "location", "object", "event", "group", or "scene"), their detailed attributes, and their relationships.

Entity Rules:
- **Explicit Entities:** Clearly stated in the prompt (presence_in_prompt: true).
- **Implicit Entities:** Entities not mentioned but logically helpful (presence_in_prompt: false). Limit to 2-3 key implicit entities.

Attribute Rules:
1. **Existence:** For EVERY entity, you **MUST** include an attribute named 'existence' (value ["true", "false"]).
2. **Rich Attributes:** For every entity, generate 3-4 descriptive attributes based on these rules:
${specificInstructions}
3. **Values:** For EVERY attribute, provide 2-3 plausible alternative candidate values as a list of strings. The first value should be the most likely one.
4. **Inference:** If an attribute is not explicitly stated in the prompt, infer a likely value and set "presence_in_prompt" to false.

Relationships:
- Identify logical directed relationships between entities (e.g., "hosting", "sitting at", "friends with", "located in").
- Set "presence_in_prompt" to true ONLY if the relationship is explicitly stated in the input prompt; set "presence_in_prompt" to false if it is inferred.
- Provide a label and 2-3 alternatives (as strings).

Input: ${JSON.stringify({ prompt })}
OUTPUT JSON:`;

  const attributeSchema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      presence_in_prompt: { type: Type.BOOLEAN },
      value: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['name', 'presence_in_prompt', 'value'],
  };

  const entitySchema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      category: { type: Type.STRING },
      presence_in_prompt: { type: Type.BOOLEAN },
      description: { type: Type.STRING },
      alternatives: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
      attributes: { type: Type.ARRAY, items: attributeSchema },
    },
    required: ['name', 'presence_in_prompt', 'description', 'attributes'],
  };

  const relationshipSchema = {
    type: Type.OBJECT,
    properties: {
      source: { type: Type.STRING },
      target: { type: Type.STRING },
      label: { type: Type.STRING },
      presence_in_prompt: { type: Type.BOOLEAN },
      evidence_excerpt: { type: Type.STRING, nullable: true },
      alternatives: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    },
    required: ['source', 'target', 'label'],
  };

  const { signal: reqSignal, cleanup } = combineSignals(signal, TEXT_TIMEOUT_MS);
  try {
    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model: GEMINI_MODELS.text,
          contents: generationPrompt,
          config: {
            abortSignal: reqSignal,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                entities: { type: Type.ARRAY, items: entitySchema },
                relationships: { type: Type.ARRAY, items: relationshipSchema },
              },
              required: ['entities', 'relationships'],
            },
          },
        }),
      { maxAttempts: 3, signal: reqSignal }
    );

    const text = response.text;
    if (!text || !text.trim()) {
      throw new AppApiError(
        'INVALID_RESPONSE',
        'Model returned an empty belief graph response.',
        502,
        false
      );
    }
    return parseAndValidateBeliefGraph(text, prompt);
  } catch (err) {
    throw classifyGeminiError(err);
  } finally {
    cleanup();
  }
}

export async function generateClarificationsList(
  prompt: string,
  askedQuestions: string[],
  mode: GenerationMode,
  signal?: AbortSignal,
  confirmedFacts: string[] = []
): Promise<Clarification[]> {
  const ai = getGeminiClient();

  const imagePrompt = `You are an expert in visual scene planning and text-to-image prompting. Your goal is to help a user refine their scene by asking adaptive, high-impact clarifying questions.`;

  const storyPrompt = `You are an expert story architect and co-creator. Your goal is to help a user develop their story idea by asking insightful, context-aware clarifying questions that directly map to character traits, setting, conflict, or tone.`;

  const specificPrompt = mode === 'story' ? storyPrompt : imagePrompt;

  const finalPrompt = `${specificPrompt}

Follow these instructions EXACTLY:
1. **Adaptive Quantity:** Generate between 2 and 4 high-impact questions (only ask questions that meaningfully shape the ${mode === 'story' ? 'narrative, characters, or setting' : 'visual scene'}).
2. **Structured Target Linking:** Whenever a question targets a specific entity attribute (e.g., Cat's personality) or story property (e.g., tone, genre, setting, centralConflict), populate \`targetType\`, \`targetEntityName\`, \`targetAttributeName\`, or \`targetStoryField\`.
3. **Answer Choices:** For EACH question, provide 3-4 distinct, evocative answer choices.
4. **Never Repeat or Ask Confirmed Facts:** DO NOT ask any of the following questions or ask about facts already confirmed:
Asked/Skipped Questions:
${askedQuestions.map((q) => `- ${JSON.stringify(q)}`).join('\n') || 'None'}
Confirmed Project Facts:
${confirmedFacts.map((f) => `- ${JSON.stringify(f)}`).join('\n') || 'None'}

User Prompt: ${JSON.stringify(prompt)}

Return a JSON array of objects.`;

  const { signal: reqSignal, cleanup } = combineSignals(signal, TEXT_TIMEOUT_MS);
  try {
    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model: GEMINI_MODELS.text,
          contents: finalPrompt,
          config: {
            abortSignal: reqSignal,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  targetType: { type: Type.STRING },
                  targetEntityName: { type: Type.STRING },
                  targetAttributeName: { type: Type.STRING },
                  targetStoryField: { type: Type.STRING },
                  category: { type: Type.STRING },
                  impact: { type: Type.STRING },
                },
                required: ['question', 'options'],
              },
            },
          },
        }),
      { maxAttempts: 3, signal: reqSignal }
    );

    const text = response.text;
    if (!text || !text.trim()) {
      throw new AppApiError(
        'INVALID_RESPONSE',
        'Model returned an empty clarification response.',
        502,
        false
      );
    }
    return parseAndValidateClarifications(text);
  } catch (err) {
    throw classifyGeminiError(err);
  } finally {
    cleanup();
  }
}

export async function interpretBatchEditInstruction(
  instruction: string,
  context: {
    prompt: string;
    entities: Array<{
      id?: string;
      name: string;
      category?: string;
      excluded?: boolean;
      attributes: Array<{ name: string; value: string; status?: string }>;
    }>;
    relationships: Array<{ id?: string; source: string; target: string; label: string }>;
  },
  signal?: AbortSignal
): Promise<BatchEditProposalResult> {
  const ai = getGeminiClient();

  const systemPrompt = `You are a precision structured-editing compiler for a creative story workspace.
Convert the user's natural-language batch edit instruction into a list of structured operations against the current entities, attributes, relationships, and story bible fields.

Rules:
1. NEVER guess when a pronoun or group reference is ambiguous (e.g., "make him older" when multiple characters exist). Instead, add an entry to \`ambiguities\` listing the candidate entities and a clarifyingQuestion.
2. When a group reference is clear (e.g. "all animal guests" or "all characters except the cat"), emit separate \`set_attribute\` operations for each matching entity and respect any "except" exclusions.
3. Supported operation types:
   - \`set_attribute\`: requires \`entityName\`, \`attributeName\`, \`nextValue\`
   - \`add_attribute\`: requires \`entityName\`, \`attributeName\`, \`nextValue\`
   - \`add_entity\`: requires \`entityName\`, \`entityCategory\`, optional \`nextValue\` (description)
   - \`rename_entity\`: requires \`entityName\`, \`newEntityName\`
   - \`exclude_entity\`: requires \`entityName\`
   - \`add_relationship\`: requires \`sourceEntityName\`, \`targetEntityName\`, \`nextValue\` (label)
   - \`update_relationship\`: requires \`sourceEntityName\`, \`targetEntityName\`, \`nextValue\` (label)
   - \`remove_relationship\`: requires \`sourceEntityName\`, \`targetEntityName\`
   - \`update_story_bible\`: requires \`storyField\` (one of: genre, tone, narrativePerspective, intendedAudience, setting, themes, centralConflict, pacing, continuityRules, explicitExclusions, visualStyle, cameraAndLighting) and \`nextValue\`
4. Flag any contradictory statements inside the instruction in \`warnings\`.
5. CRITICAL: If any clause or sub-instruction in the user's request cannot be mapped to one of the supported operation types or references a nonexistent target, include the exact clause text in \`unhandledClauses\` instead of silently ignoring it.

Current Project Context:
${JSON.stringify(context, null, 2)}

User Batch Instruction: ${JSON.stringify(instruction)}`;

  const { signal: reqSignal, cleanup } = combineSignals(signal, TEXT_TIMEOUT_MS);
  try {
    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model: GEMINI_MODELS.text,
          contents: systemPrompt,
          config: {
            abortSignal: reqSignal,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                operations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      summary: { type: Type.STRING },
                      entityName: { type: Type.STRING },
                      newEntityName: { type: Type.STRING },
                      entityCategory: { type: Type.STRING },
                      attributeName: { type: Type.STRING },
                      nextValue: { type: Type.STRING },
                      sourceEntityName: { type: Type.STRING },
                      targetEntityName: { type: Type.STRING },
                      storyField: { type: Type.STRING },
                    },
                    required: ['type', 'summary'],
                  },
                },
                ambiguities: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      phrase: { type: Type.STRING },
                      reason: { type: Type.STRING },
                      candidates: { type: Type.ARRAY, items: { type: Type.STRING } },
                      clarifyingQuestion: { type: Type.STRING },
                    },
                    required: ['phrase', 'reason', 'candidates', 'clarifyingQuestion'],
                  },
                },
                warnings: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                unhandledClauses: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['operations', 'ambiguities', 'warnings'],
            },
          },
        }),
      { maxAttempts: 3, signal: reqSignal }
    );

    const text = response.text;
    if (!text || !text.trim()) {
      throw new AppApiError(
        'INVALID_RESPONSE',
        'Model returned an empty batch-edit interpretation.',
        502,
        false
      );
    }
    return parseAndValidateBatchEditResponse(text, instruction);
  } catch (err) {
    throw classifyGeminiError(err);
  } finally {
    cleanup();
  }
}

export async function refinePromptText(
  originalPrompt: string,
  clarifications: ClarificationAnswer[],
  graphUpdates: GraphUpdate[],
  signal?: AbortSignal
): Promise<string> {
  const ai = getGeminiClient();
  let updatesPromptSection = '';

  if (graphUpdates.length > 0) {
    const graphList = graphUpdates
      .map((u) => {
        if (u.type === 'attribute') {
          return `- For entity ${JSON.stringify(u.entity)}, set attribute ${JSON.stringify(u.attribute)} to ${JSON.stringify(u.value)}.`;
        }
        return `- Change relationship between ${JSON.stringify(u.source)} and ${JSON.stringify(u.target)} from ${JSON.stringify(u.oldLabel)} to ${JSON.stringify(u.newLabel)}.`;
      })
      .join('\n');
    updatesPromptSection += `\nSPECIFIC EDITS TO APPLY:\n${graphList}\n`;
  }

  if (clarifications.length > 0) {
    const qaList = clarifications
      .map((c) => `- User Answer to ${JSON.stringify(c.question)}: ${JSON.stringify(c.answer)}`)
      .join('\n');
    updatesPromptSection += `\nNEW INFORMATION FROM Q&A:\n${qaList}\n`;
  }

  const prompt =
    clarifications.length === 0 && graphUpdates.length === 0
      ? `You are an expert narrative and visual prompt architect.
Rewrite and polish the following structured creative brief into a cohesive, vivid, contradiction-free generation prompt while preserving every single confirmed fact, canonical character name override, relationship, and explicit exclusion.

Structured Creative Brief:
${JSON.stringify(originalPrompt)}

Strict Rules:
1. **Canonical Names & Seed Overrides:** If the brief specifies a Seed Override (e.g., replacing "cat" with "Barnaby" or excluding an entity), replace the old seed noun in the narrative with the canonical name and remove any excluded entity from the scene description.
2. **Preserve Every Confirmed Fact:** Keep all confirmed attributes, relationships, Story Bible properties, explicit exclusions, and author notes intact.
3. **Never Invent Unconfirmed Facts:** Do not add new characters or plot points that are not in the brief.
4. **Return Only the Polished Prompt Text:** No markdown code fences or meta-commentary.

Polished Prompt:`
      : `You are an expert prompt engineer. Your goal is to rewrite the prompt to seamlessly incorporate specific user edits while strictly preserving all other existing details.

Original Prompt: ${JSON.stringify(originalPrompt)}

${updatesPromptSection}

Instructions:
1. **Integrate Attributes:** When an attribute is set (e.g., "personality" to "mischievous"), ensure the entity is explicitly described with that attribute.
2. **Update Relationships:** If a relationship changes, rewrite the interaction between the entities to reflect the new state.
3. **Incorporate Answers:** Treat user answers from clarifications as definitive facts and weave them into the scene.
4. **Preserve Context:** CRITICAL: Do NOT remove, summarize, or condense any existing details, entities, or stylistic elements from the "Original Prompt". Only remove details if they are explicitly contradicted by the edits.
5. **Exclusion:** CRITICAL: If an edit sets "existence" or "existence_in_image" to "false" (or "Absent"), you MUST remove that entity and its related descriptions entirely.
6. **Style:** Maintain the original tone.

Do not add any extra explanations, just return the updated prompt string.

Updated Prompt:`;

  const { signal: reqSignal, cleanup } = combineSignals(signal, TEXT_TIMEOUT_MS);
  try {
    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model: GEMINI_MODELS.text,
          contents: prompt,
          config: {
            abortSignal: reqSignal,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
      { maxAttempts: 3, signal: reqSignal }
    );

    const refined = response.text?.trim();
    if (!refined) {
      throw new AppApiError(
        'INVALID_RESPONSE',
        'Model returned an empty refined prompt.',
        502,
        false
      );
    }
    return refined;
  } catch (err) {
    throw classifyGeminiError(err);
  } finally {
    cleanup();
  }
}

export async function generateStoryText(
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const ai = getGeminiClient();
  const storyGenerationPrompt = `Based on the following structured story brief and creative constraints, write a vivid, engaging, well-structured story.
Respect every confirmed character trait, relationship, setting detail, tone, and explicit exclusion.

Story Brief: ${JSON.stringify(prompt)}

Story:`;

  const { signal: reqSignal, cleanup } = combineSignals(signal, TEXT_TIMEOUT_MS);
  try {
    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model: GEMINI_MODELS.text,
          contents: storyGenerationPrompt,
          config: {
            abortSignal: reqSignal,
          },
        }),
      { maxAttempts: 3, signal: reqSignal }
    );

    const text = response.text?.trim();
    if (!text) {
      throw new AppApiError(
        'INVALID_RESPONSE',
        'Model returned an empty story response.',
        502,
        false
      );
    }
    return text;
  } catch (err) {
    throw classifyGeminiError(err);
  } finally {
    cleanup();
  }
}

export async function generateImagesBatch(
  prompt: string,
  signal?: AbortSignal,
  clientOverride?: ReturnType<typeof getGeminiClient>,
): Promise<ImageGenerationResult> {
  const policy = AI_OPERATION_POLICIES.image;
  const budget = evaluateOperationBudget({
    operation: 'image', model: policy.model, inputChars: prompt.length,
    estimatedInputTokens: estimateTokensFromText(prompt),
    maxInputTokens: policy.maxInputTokens, maxOutputTokens: policy.maxOutputTokens,
  });
  if (!budget.ok) throw new AppApiError('VALIDATION_ERROR', budget.reason ?? 'The image request exceeds its conservative application budget.', 400, false);
  if (signal?.aborted) throw new AppApiError('CANCELLED', 'The request was cancelled.', 499, false);
  const slot = acquireAiSlot('image');
  if (!slot.ok) throw new AppApiError('RATE_LIMITED', slot.reason, 429, true);
  const operationKey = randomUUID();
  const batchController = new AbortController();
  const abortBatch = () => batchController.abort(signal?.reason);
  signal?.addEventListener('abort', abortBatch, { once: true });

  try {
  const ai = clientOverride ?? getGeminiClient();

  const generateSingleImage = async (): Promise<{ image: string | null; error: AppApiError | null }> => {
    const { signal: slotSignal, cleanup } = combineSignals(batchController.signal, IMAGE_TIMEOUT_MS);
    try {
      const response = await withRetry(
        () => {
          const aggregate = reserveAggregateOperationUsage({ policy, operationKey, inputTokens: budget.inputTokens });
          if (!aggregate.ok) throw new AppApiError('RATE_LIMITED', aggregate.reason, 429, false);
          return ai.models.generateContent({
            model: GEMINI_MODELS.image,
            contents: { parts: [{ text: prompt }] },
            config: {
              abortSignal: slotSignal,
              imageConfig: {
                aspectRatio: '1:1',
              },
            },
          });
        },
        { maxAttempts: 2, initialDelayMs: 1000, signal: slotSignal }
      );

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || 'image/png';
          return {
            image: `data:${mimeType};base64,${part.inlineData.data}`,
            error: null,
          };
        }
      }

      return {
        image: null,
        error: new AppApiError(
          'INVALID_RESPONSE',
          'Model completed without returning image bytes.',
          502,
          false
        ),
      };
    } catch (err) {
      const classified = classifyGeminiError(err);
      if (classified.code === 'CANCELLED' || classified.code === 'MISSING_API_KEY' || classified.code === 'AUTH_ERROR') {
        throw classified;
      }
      return { image: null, error: classified };
    } finally {
      cleanup();
    }
  };

  const tasks = Array.from({ length: TARGET_IMAGE_COUNT }, () => generateSingleImage);
  const slotResults = await runWithConcurrency(tasks, IMAGE_CONCURRENCY, (err) => batchController.abort(err));

  const images = slotResults
    .map((r) => r.image)
    .filter((img): img is string => img !== null);
  const errors = slotResults
    .map((r) => r.error)
    .filter((e): e is AppApiError => e !== null);

  if (images.length === 0) {
    throw (
      errors[0] ??
      new AppApiError('UPSTREAM_ERROR', 'All image generation requests failed.', 502, true)
    );
  }

  const failedCount = TARGET_IMAGE_COUNT - images.length;
  const warning =
    failedCount > 0
      ? `${images.length} of ${TARGET_IMAGE_COUNT} images succeeded (${failedCount} failed: ${errors[0]?.message ?? 'upstream error'}).`
      : null;

  return {
    images,
    requestedCount: TARGET_IMAGE_COUNT,
    failedCount,
    warning,
  };
  } finally {
    signal?.removeEventListener('abort', abortBatch);
    batchController.abort();
    slot.release();
  }
}
