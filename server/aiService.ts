/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ThinkingLevel, Type } from '@google/genai';
import type {
  BeliefState,
  Clarification,
  ClarificationAnswer,
  GenerationMode,
  GraphUpdate,
  ImageGenerationResult,
  VideoJobStatusResult,
} from '../shared/types.ts';
import {
  parseAndValidateBeliefGraph,
  parseAndValidateClarifications,
} from '../shared/schemas.ts';
import { AppApiError, classifyGeminiError } from './errors.ts';
import { getGeminiClient } from './geminiClient.ts';
import { GEMINI_MODELS } from './models.ts';
import { withRetry } from './retry.ts';
import { videoStore } from './videoStore.ts';

const TEXT_TIMEOUT_MS = 45_000;
const IMAGE_TIMEOUT_MS = 60_000;
const VIDEO_TIMEOUT_MS = 60_000;
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
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
    }
  });

  await Promise.all(workers);
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
      - **The Image Entity:** Always include an entity named "The Image". Required Attributes: weather, location, time of day, atmosphere, camera angle, image style.
      - **Human Subjects:** If an entity is human, include Attributes: age, gender, ethnicity, hair_style, clothing, expression, pose.
      - **Objects:** Include Attributes: color, material, shape, size, texture, lighting.
    `;
  } else if (mode === 'video') {
    specificInstructions = `
      - **The Video Entity:** Always include an entity named "The Video". Required Attributes: camera_movement, lighting, atmosphere, video_style, pacing, duration_feel.
      - **Subjects:** If an entity is active, include Attributes: movement, expression, action_speed, clothing.
      - **Setting:** Include Attributes: location, weather, time_of_day, ambience.
    `;
  } else {
    specificInstructions = `
      - **The Story Entity:** Always include an entity named "The Story". Required Attributes: genre, tone, narrative_perspective, pacing, central_conflict.
      - **Characters:** Include Attributes: personality, motivation, role, age, background, emotional_state.
    `;
  }

  const generationPrompt = `
Analyze the prompt and generate a complete **Belief Graph** representing the scene or story.
Identify all entities, their detailed attributes, and their relationships.

Entity Types:
- **Explicit Entities:** Clearly stated in the prompt (presence_in_prompt: True).
- **Implicit Entities:** Entities not mentioned but logically necessary (presence_in_prompt: False). Limit to 2-3 key implicit entities.

Attribute Rules:
1. **Existence:** For EVERY entity, you **MUST** include an attribute named 'existence' (value "true" or "false").
2. **Rich Attributes:** For every entity, generate 3-4 descriptive attributes based on these rules:
${specificInstructions}
3. **Values:** For EVERY attribute, provide 2-3 plausible alternative candidate values as a list of strings. The first value should be the most likely one.
4. **Inference:** If an attribute is not explicitly stated, infer a likely value and set "presence_in_prompt" to false.

Relationships:
- Identify logical relationships between entities (e.g., "holding", "next to", "part of").
- Provide a label and alternatives (as strings).

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
  signal?: AbortSignal
): Promise<Clarification[]> {
  const ai = getGeminiClient();

  const imagePrompt = `You are an expert in text-to-image prompting. Your goal is to help a user refine their prompt by asking clarifying questions.
First, reason about the user's prompt to identify entities, their attributes, and areas of visual uncertainty.
Then, generate questions that target these uncertainties to gather more specific visual details.

Focus on:
- Implicit entities (things not explicitly mentioned but likely to be in the scene).
- Vague attributes (e.g., if it says "a car", ask about the color or model).
- Ambiguous scene properties (e.g., location, time of day, style).`;

  const videoPrompt = `You are an expert in AI video generation prompting. Your goal is to help a user refine their prompt by asking clarifying questions.
First, reason about the user's prompt to identify the visual narrative, camera movement, and temporal dynamics.
Then, generate questions that target these uncertainties.

Focus on:
- Movement and Action (e.g., "How does the character move?", "Is the action fast or slow?").
- Camera Dynamics (e.g., "Should the camera zoom, pan, or stay static?").
- Atmosphere and Lighting changes over time.`;

  const storyPrompt = `You are a creative writing assistant. Your goal is to help a user develop their story idea by asking insightful clarifying questions based on their initial prompt.
First, reason about the prompt to identify potential characters, settings, plot points, and themes.
Then, generate questions that explore areas that would enrich the narrative.

Focus on:
- Character motivations or backstories.
- Plot developments or potential conflicts.
- Setting details that could influence the mood.
- The overall tone or theme of the story.`;

  const specificPrompt =
    mode === 'story' ? storyPrompt : mode === 'video' ? videoPrompt : imagePrompt;

  const finalPrompt = `${specificPrompt}

Follow these instructions EXACTLY:
1. **Quantity:** Generate EXACTLY 3 questions.
2. **Clarity & Conciseness:** Questions must be very clear, concise, and direct.
3. **Ease of Answering:** Questions should be easy for a human to answer, ideally by selecting from predefined choices.
4. **Information Diversity:** The three questions MUST be different from each other and aim to collect information about distinct aspects.
5. **Answer Choices:** For EACH question, provide a list of 3-5 plausible and distinct answer choices.
6. **Avoid Repetition**: DO NOT ask any of the following questions (or questions semantically identical to them), as they have already been answered or rejected by the user:
${askedQuestions.map((q) => `- ${JSON.stringify(q)}`).join('\n') || 'N/A'}

User Prompt: ${JSON.stringify(prompt)}

Return the output as a JSON array of objects, where each object has a 'question' and an 'options' array.`;

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

export async function refinePromptText(
  originalPrompt: string,
  clarifications: ClarificationAnswer[],
  graphUpdates: GraphUpdate[],
  signal?: AbortSignal
): Promise<string> {
  if (clarifications.length === 0 && graphUpdates.length === 0) {
    return originalPrompt;
  }

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

  const prompt = `You are an expert prompt engineer. Your goal is to rewrite the prompt to seamlessly incorporate specific user edits while strictly preserving all other existing details.

Original Prompt: ${JSON.stringify(originalPrompt)}

${updatesPromptSection}

Instructions:
1. **Integrate Attributes:** When an attribute is set (e.g., "color" to "blue"), ensure the entity is explicitly described with that attribute in the narrative.
2. **Update Relationships:** If a relationship changes, rewrite the interaction between the entities to reflect the new state.
3. **Incorporate Answers:** Treat user answers from clarifications as definitive facts and weave them into the scene.
4. **Preserve Context:** CRITICAL: Do NOT remove, summarize, or condense any existing details, entities, or stylistic elements from the "Original Prompt". The goal is accretion and modification, not summarization. Only remove details if they are explicitly contradicted by the edits.
5. **Exclusion:** CRITICAL: If an edit sets "existence" or "existence_in_image" to "false" (or "Absent"), you MUST remove that entity and its related descriptions entirely.
6. **Style:** Maintain the original tone (e.g., if it's a story, keep it narrative; if an image prompt, keep it descriptive).

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
  const storyGenerationPrompt = `Based on the following idea, write a short, creative story. The story should be engaging, vivid, and well-structured.

Idea: ${JSON.stringify(prompt)}

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
  signal?: AbortSignal
): Promise<ImageGenerationResult> {
  const ai = getGeminiClient();

  const generateSingleImage = async (): Promise<{ image: string | null; error: AppApiError | null }> => {
    const { signal: slotSignal, cleanup } = combineSignals(signal, IMAGE_TIMEOUT_MS);
    try {
      const response = await withRetry(
        () =>
          ai.models.generateContent({
            model: GEMINI_MODELS.image,
            contents: { parts: [{ text: prompt }] },
            config: {
              abortSignal: slotSignal,
              imageConfig: {
                aspectRatio: '1:1',
              },
            },
          }),
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
  const slotResults = await runWithConcurrency(tasks, IMAGE_CONCURRENCY);

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
}

async function resolveVideoBytes(
  videoPart: { data?: string; uri?: string; mime_type?: string },
  signal: AbortSignal
): Promise<{ buffer: Buffer; mimeType: string }> {
  const mimeType = videoPart.mime_type || 'video/mp4';

  if (videoPart.data) {
    return {
      buffer: Buffer.from(videoPart.data, 'base64'),
      mimeType,
    };
  }

  if (videoPart.uri) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const res = await fetch(videoPart.uri, {
      headers: apiKey ? { 'x-goog-api-key': apiKey } : undefined,
      signal,
    });
    if (!res.ok) {
      throw new AppApiError(
        'UPSTREAM_ERROR',
        `Failed to retrieve generated video media (HTTP ${res.status}).`,
        502,
        true
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: res.headers.get('content-type') || mimeType,
    };
  }

  throw new AppApiError(
    'INVALID_RESPONSE',
    'Video generation completed without video data or URI.',
    502,
    false
  );
}

async function formatInteractionResult(
  interaction: {
    id: string;
    status: string;
    output_video?: { data?: string; uri?: string; mime_type?: string };
  },
  signal: AbortSignal
): Promise<VideoJobStatusResult> {
  if (interaction.status === 'completed') {
    if (!interaction.output_video) {
      throw new AppApiError(
        'INVALID_RESPONSE',
        'Video generation completed without output_video payload.',
        502,
        false
      );
    }
    const { buffer, mimeType } = await resolveVideoBytes(interaction.output_video, signal);
    const videoId = videoStore.put(buffer, mimeType);
    return {
      status: 'completed',
      interactionId: interaction.id,
      videoUrl: `/api/videos/${videoId}`,
    };
  }

  if (
    interaction.status === 'failed' ||
    interaction.status === 'incomplete' ||
    interaction.status === 'budget_exceeded'
  ) {
    return {
      status: 'failed',
      interactionId: interaction.id,
      error: `Video generation ended with status "${interaction.status}".`,
    };
  }

  if (interaction.status === 'cancelled') {
    return {
      status: 'cancelled',
      interactionId: interaction.id,
      error: 'Video generation was cancelled.',
    };
  }

  return {
    status: 'in_progress',
    interactionId: interaction.id,
  };
}

export async function startVideoGeneration(
  prompt: string,
  signal?: AbortSignal
): Promise<VideoJobStatusResult> {
  const ai = getGeminiClient();
  const { signal: reqSignal, cleanup } = combineSignals(signal, VIDEO_TIMEOUT_MS);

  try {
    const interaction = await ai.interactions.create(
      {
        model: GEMINI_MODELS.video,
        input: prompt,
        background: true,
        store: true,
        stream: false,
        response_format: {
          type: 'video',
          aspect_ratio: '16:9',
          duration: '10s',
          resolution: '720p',
        },
      },
      { signal: reqSignal, timeout: VIDEO_TIMEOUT_MS }
    );

    return await formatInteractionResult(interaction, reqSignal);
  } catch (err) {
    throw classifyGeminiError(err);
  } finally {
    cleanup();
  }
}

export async function getVideoGenerationStatus(
  interactionId: string,
  signal?: AbortSignal
): Promise<VideoJobStatusResult> {
  const ai = getGeminiClient();
  const { signal: reqSignal, cleanup } = combineSignals(signal, VIDEO_TIMEOUT_MS);

  try {
    const interaction = await ai.interactions.get(interactionId, undefined, {
      signal: reqSignal,
      timeout: VIDEO_TIMEOUT_MS,
    });
    return await formatInteractionResult(interaction, reqSignal);
  } catch (err) {
    throw classifyGeminiError(err);
  } finally {
    cleanup();
  }
}

export async function cancelVideoGeneration(interactionId: string): Promise<void> {
  const ai = getGeminiClient();
  try {
    await ai.interactions.cancel(interactionId);
  } catch {
    // Best-effort cancellation on upstream job
  }
}
