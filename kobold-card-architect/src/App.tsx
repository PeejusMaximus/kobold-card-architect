import { CharacterEditor } from "./components/CharacterEditor";
import { ThemeToggle } from "./components/ThemeToggle";
import { Sparkles } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
      <header className="border-b bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary p-1.5 rounded-lg">
              <Sparkles className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Kobold Card Architect</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] font-medium">AI Character Card Studio</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="py-8">
        <CharacterEditor />
      </main>

      <footer className="border-t py-8 bg-muted/20">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Kobold Card Architect. Built for the roleplay community.</p>
        </div>
      </footer>
    </div>
  );
}
