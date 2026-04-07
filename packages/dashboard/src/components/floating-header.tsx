import { Link } from "react-router";
import { LayoutDashboard, BookText, ChevronDown, Puzzle, Radio, BookOpen, ExternalLink } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import logoSvg from "@/assets/logo.svg";

const skills = [
  { href: "https://clawhub.ai/dmytrotkk/smartclaws-producer", label: "Producer", icon: Radio },
  { href: "https://clawhub.ai/dmytrotkk/smartclaws-reader", label: "Reader", icon: BookOpen },
];

export function FloatingHeader() {
  const [skillsOpen, setSkillsOpen] = useState(false);
  const skillsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (skillsRef.current && !skillsRef.current.contains(e.target as Node)) {
        setSkillsOpen(false);
      }
    }
    if (skillsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [skillsOpen]);

  return (
    <header className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
      <nav className="flex items-center gap-1 rounded-full border border-border/50 bg-background/60 backdrop-blur-xl p-2 shadow-lg">
        <Link to="/" className="flex items-center gap-1.5 px-3 py-1">
          <img src={logoSvg} alt="SmartClaws" className="h-4 w-4" />
          <span className="hidden md:inline text-sm font-medium tracking-tight" style={{ color: "#FFD7DA" }}>SmartClaws</span>
        </Link>
        <div className="h-4 w-px bg-border/50" />
        <Link
          to="/overview"
          className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Dashboard</span>
        </Link>
        <a
          href="https://docs.skale.space/get-started/skale"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          <BookText className="h-3.5 w-3.5" />
          Docs
        </a>
        <div className="relative group" ref={skillsRef}>
          <button
            onClick={() => setSkillsOpen(!skillsOpen)}
            className="flex items-center gap-1.5 rounded-full pl-4 pr-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <Puzzle className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Skills</span>
            <ChevronDown className={`h-3 w-3 -mr-0.5 transition-transform ${skillsOpen ? "rotate-180" : ""} md:group-hover:rotate-180`} />
          </button>
          <div className={`absolute top-full right-0 pt-2 transition-all duration-150 ${skillsOpen ? "visible opacity-100" : "invisible opacity-0 md:group-hover:visible md:group-hover:opacity-100"}`}>
            <div className="min-w-36 rounded-xl border border-border/50 bg-background/80 backdrop-blur-xl p-1 shadow-lg">
              {skills.map(({ href, label, icon: Icon }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  <ExternalLink className="h-3 w-3 ml-auto opacity-40" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
