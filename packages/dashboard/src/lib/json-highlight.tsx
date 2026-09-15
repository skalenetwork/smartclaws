import type { ReactNode } from "react";

/**
 * Syntax-colours a JSON string for display in a `<pre>`.
 *
 * Shared by every view that dumps a raw record — message payloads in the channel
 * table and disclosure ciphertexts in the access log — so the two read the same.
 */
export function highlightJson(json: string): ReactNode[] {
    const parts: ReactNode[] = [];
    const regex =
        /("(?:\\.|[^"\\])*")\s*(:)?|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g;
    let lastIndex = 0;
    let match = regex.exec(json);

    while (match !== null) {
        if (match.index > lastIndex) {
            parts.push(json.slice(lastIndex, match.index));
        }
        const [full, str, colon, bool, num, punct] = match;
        if (str) {
            if (colon) {
                parts.push(
                    <span key={match.index} className="text-sky-400">
                        {str}
                    </span>,
                    <span key={`${match.index}c`} className="text-muted-foreground">
                        :
                    </span>,
                );
            } else {
                parts.push(
                    <span key={match.index} className="text-emerald-400">
                        {str}
                    </span>,
                );
            }
        } else if (bool) {
            parts.push(
                <span key={match.index} className="text-violet-400">
                    {full}
                </span>,
            );
        } else if (num) {
            parts.push(
                <span key={match.index} className="text-amber-400">
                    {full}
                </span>,
            );
        } else if (punct) {
            parts.push(
                <span key={match.index} className="text-muted-foreground">
                    {full}
                </span>,
            );
        }
        lastIndex = match.index + full.length;
        match = regex.exec(json);
    }
    if (lastIndex < json.length) {
        parts.push(json.slice(lastIndex));
    }
    return parts;
}
