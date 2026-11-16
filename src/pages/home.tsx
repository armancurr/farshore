import { GamePanel } from "../components/game/game-panel";

interface HomePageProps {
  onPress: () => void;
}

/* The whole page is the game. */
export function HomePage(props: HomePageProps) {
  return (
    <div class="bg-background text-foreground h-svh overflow-hidden">
      <h1 class="sr-only">Rising Tide</h1>
      <main class="relative h-full w-full">
        <GamePanel onPress={props.onPress} />
      </main>
    </div>
  );
}
