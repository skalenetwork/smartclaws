import { createContext, useContext, useState, type ReactNode } from "react";

const HeaderActionsContext = createContext<{
    actions: ReactNode;
    setActions: (node: ReactNode) => void;
}>({ actions: null, setActions: () => {} });

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
    const [actions, setActions] = useState<ReactNode>(null);
    return (
        <HeaderActionsContext.Provider value={{ actions, setActions }}>
            {children}
        </HeaderActionsContext.Provider>
    );
}

export function useHeaderActions() {
    return useContext(HeaderActionsContext);
}
