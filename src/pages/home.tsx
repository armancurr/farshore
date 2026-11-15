import { GamePanel } from "../components/game/game-panel";
import { Profile } from "../components/profile";

interface HomePageProps {
  onPress: () => void;
}

export function HomePage(props: HomePageProps) {
  return (
    <div class="bg-background text-foreground lg:flex lg:h-screen lg:overflow-hidden">
      <h1 class="sr-only">Arman Kar, Software Developer</h1>
      <main class="border-border relative h-[78svh] w-full border-b lg:h-screen lg:w-2/3 lg:border-r lg:border-b-0">
        <GamePanel onPress={props.onPress} />
      </main>
      <aside class="w-full lg:h-screen lg:w-1/3 lg:overflow-y-auto">
        <Profile onPress={props.onPress} />
      </aside>
    </div>
  );
}
