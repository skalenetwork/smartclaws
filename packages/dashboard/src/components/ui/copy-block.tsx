import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface CopyBlockProps {
    code: string;
    className?: string;
}

export function CopyBlock({ code, className }: CopyBlockProps) {
    const [copied, setCopied] = useState(false);

    function handleCopy() {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <div
            className={cn(
                "flex items-center gap-3 rounded-xl bg-neutral-900 dark:bg-neutral-800 py-4 pl-5 pr-4 overflow-x-auto",
                className,
            )}
        >
            <pre className="flex-1 min-w-0 font-mono text-sm text-neutral-200 leading-relaxed">
                {code}
            </pre>
            <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 p-1.5 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 transition-colors"
            >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
        </div>
    );
}
