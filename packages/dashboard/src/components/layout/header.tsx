import logoSvg from "@/assets/logo.svg";

export function Header() {
  return (
    <header className="flex items-center h-14 px-6 md:hidden">
      <div className="flex items-center gap-2.5">
        <img src={logoSvg} alt="SmartClaws" className="h-5 w-5" />
        <span className="font-semibold text-sm tracking-tight">SmartClaws</span>
      </div>
    </header>
  );
}
