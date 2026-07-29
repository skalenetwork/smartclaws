import { Type } from "typebox";
import { formatChatIds, formatRecords, parseCommandSelector, type RecordStore } from "./status.js";

const NO_SESSION =
    "No trusted session context is available; nearai-verify records cannot be read safely.";

export interface VerificationToolContext {
    sessionId?: string;
}

/** Build read-only, session-scoped agent tools over settled verification records. */
export function createVerificationTools(ctx: VerificationToolContext, store: RecordStore) {
    return [
        {
            name: "nearai_list_chat_ids",
            label: "List NEAR AI Verification Chat IDs",
            description:
                "List the NEAR AI completion chat IDs with verification results in the current conversation, newest first. Read-only and session-scoped.",
            promptSnippet:
                "List NEAR AI verification chat IDs available in the current conversation.",
            parameters: Type.Object({}),
            execute: async () => ({
                content: [
                    {
                        type: "text" as const,
                        text: ctx.sessionId
                            ? formatChatIds(store.listChatIds(ctx.sessionId))
                            : NO_SESSION,
                    },
                ],
                details: {},
            }),
        },
        {
            name: "nearai_verify",
            label: "Read NEAR AI Verification",
            description:
                "Read the settled NEAR AI TEE verification result for the latest completion or a specific chat ID in the current conversation. Read-only; does not perform or alter verification.",
            promptSnippet:
                "Read the cryptographic NEAR AI verification result for the latest completion or a chat ID.",
            parameters: Type.Object({
                selector: Type.Optional(
                    Type.String({
                        description: 'Use "latest" (the default) or an exact chat ID.',
                    }),
                ),
            }),
            execute: async (
                _toolCallId: string,
                params: {
                    selector?: string;
                },
            ) => ({
                content: [
                    {
                        type: "text" as const,
                        text: ctx.sessionId
                            ? formatRecords(
                                  store.query({
                                      sessionId: ctx.sessionId,
                                      isOwner: false,
                                      selector: parseCommandSelector(params.selector),
                                  }),
                              )
                            : NO_SESSION,
                    },
                ],
                details: {},
            }),
        },
    ];
}
