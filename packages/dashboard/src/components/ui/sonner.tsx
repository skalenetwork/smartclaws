import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
    return (
        <Sonner
            className="toaster group"
            position="bottom-right"
            toastOptions={{
                classNames: {
                    toast: "group toast !backdrop-blur-md !bg-emerald-500/15 !text-emerald-400 !border !border-emerald-500/20 !shadow-lg !rounded-2xl !py-2.5 !px-3.5 !text-sm !font-normal !min-h-0 !min-w-0 !w-auto !max-w-[calc(100vw-2rem)]",
                    icon: "!text-emerald-400",
                },
            }}
            {...props}
        />
    );
}
