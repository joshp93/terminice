import type { Prompt } from "./dialogModels";

/** A plan waiting to be approved, with the id that tells one from the next. */
export type WaitingPlan = {
  /** The request the plan is waiting on, which changes with every plan. */
  requestId: string;
  /** The plan itself, as the reply that wrote it did. */
  text: string;
};

/**
 * Reads the plan a session is waiting on approval for.
 *
 * Only a plan prompt has one: an approval for a tool, or a question, is not
 * something with a text to read at length beside the transcript. The plan is on
 * the prompt because that is where the CLI leaves it — the `ExitPlanMode` call
 * itself carries none — and it stops being one the moment the prompt is
 * answered, which is what takes the panel away again.
 *
 * @param prompt - The prompt the session is waiting on, if any.
 * @returns The waiting plan, or null when there is not one.
 */
export function planOf(prompt: Prompt | null): WaitingPlan | null {
  if (prompt === null || prompt.kind !== "plan") return null;
  return { requestId: prompt.requestId, text: prompt.plan };
}
