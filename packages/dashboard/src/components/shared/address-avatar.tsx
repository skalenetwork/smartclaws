import BoringAvatar from "boring-avatars";

// boring-avatars is CJS — handle both interop styles
const Avatar =
    typeof BoringAvatar === "function"
        ? BoringAvatar
        : (BoringAvatar as { default: typeof BoringAvatar }).default;

export type AvatarKind = "group" | "device" | "channel";

const palettes: Record<AvatarKind, string[]> = {
    group: ["#6366f1", "#ec4899", "#f59e0b", "#06b6d4", "#8b5cf6"],
    device: ["#10b981", "#3b82f6", "#f97316", "#e879f9", "#14b8a6"],
    channel: ["#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16"],
};

const variants: Record<AvatarKind, "beam" | "marble" | "pixel" | "bauhaus"> = {
    group: "beam",
    device: "beam",
    channel: "marble",
};

interface AddressAvatarProps {
    address: string;
    size?: number;
    kind?: AvatarKind;
}

export function AddressAvatar({ address, size = 32, kind = "device" }: AddressAvatarProps) {
    return <Avatar size={size} name={address} variant={variants[kind]} colors={palettes[kind]} />;
}
