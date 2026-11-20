import { type Static, Type } from "typebox";

export const compareSchema = Type.Object(
  {
    prompt: Type.String({
      minLength: 1,
      description:
        "The prompt sent to every model, identical for each. Models answer text-only with no tools.",
    }),
    models: Type.Union([
      Type.String({
        description:
          'Comma-separated model references (e.g. "claude-sonnet, gemini-flash, gpt-6.1-sol"). ' +
          "Bare ids match across providers preferring the current one; provider/id pins exactly. 2–4 models.",
      }),
      Type.Null(),
    ]),
    system: Type.Union([
      Type.String({
        description: "Optional system prompt shared by all compared models.",
      }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false }
);
export type CompareInput = Static<typeof compareSchema>;

export type CompareEntry = {
  readonly ref: string;
  readonly model: string;
  readonly ok: boolean;
  readonly text: string;
  readonly error: string | null;
  readonly durationMs: number;
  readonly cost: number;
  readonly outputTokens: number;
};

export type CompareDetails = {
  readonly entries: readonly CompareEntry[];
};
