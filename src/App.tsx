import { useEffect } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { haptics } from "./lib/use-haptics";
import { playLensClick, unlockAudio } from "./lib/use-sound";
import { HomePage } from "./pages/home";
import { NotFoundPage } from "./pages/not-found";

type AppRoute = { name: "home" } | { name: "not-found" };

function getRoute(pathname: string): AppRoute {
  if (pathname === "/") return { name: "home" };

  return { name: "not-found" };
}

const handlePress = () => {
  void unlockAudio().then((ready) => {
    if (ready) playLensClick({ direction: 1, intensity: 0.7 });
  });

  haptics.click();
};

export default function App() {
  const route = getRoute(window.location.pathname);

  useEffect(() => {
    const primeAudio = () => {
      void unlockAudio();
    };

    window.addEventListener("pointerdown", primeAudio, { capture: true });
    window.addEventListener("keydown", primeAudio, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", primeAudio, { capture: true });
      window.removeEventListener("keydown", primeAudio, { capture: true });
    };
  }, []);

  return (
    <TooltipProvider>
      {route.name === "not-found" ? <NotFoundPage /> : <HomePage onPress={handlePress} />}
    </TooltipProvider>
  );
}
