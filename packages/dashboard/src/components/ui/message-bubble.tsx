import { useRef, useState, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
    children: ReactNode;
    variant?: "primary" | "secondary";
    clickable?: boolean;
    className?: string;
}

export function MessageBubble({
    children,
    variant = "primary",
    clickable = true,
    className,
}: MessageBubbleProps) {
    const [copied, setCopied] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    function handleCopy() {
        if (!clickable) return;
        const text = typeof children === "string" ? children : (ref.current?.textContent ?? "");
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success("Copied to clipboard", { duration: 1500 });
        setTimeout(() => setCopied(false), 500);
    }

    const isPrimary = variant === "primary";

    return (
        <div
            ref={ref}
            className={cn(
                "relative max-w-[85%] text-[15px] leading-relaxed transition-all duration-100",
                // Bubble shape — iMessage-style tail
                isPrimary
                    ? "self-end rounded-2xl rounded-br-sm bg-bubble-primary text-bubble-primary-foreground"
                    : "self-start rounded-2xl rounded-bl-sm bg-bubble-secondary text-bubble-secondary-foreground",
                // Clickable styles
                clickable && "cursor-pointer select-none active:scale-[0.98]",
                clickable && isPrimary && "hover:brightness-110",
                clickable && !isPrimary && "hover:brightness-95 dark:hover:brightness-110",
                // Copied feedback
                copied && "scale-[0.97] opacity-80",
                // Padding: extra right padding when copy button is shown
                clickable ? "pl-4 pr-2 py-2" : "px-4 py-2.5",
                className,
            )}
            onClick={handleCopy}
        >
            <div className="flex items-center gap-2">
                <span className="flex-1">{children}</span>
                {clickable && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleCopy();
                        }}
                        className={cn(
                            "shrink-0 p-1 rounded-md transition-colors",
                            isPrimary
                                ? "text-white/60 hover:text-white/90"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {copied ? (
                            <Check className="h-3.5 w-3.5" />
                        ) : (
                            <Copy className="h-3.5 w-3.5" />
                        )}
                    </button>
                )}
            </div>
        </div>
    );
}
