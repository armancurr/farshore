import { GamePanel } from "../components/game/game-panel";

interface HomePageProps {
  onPress: () => void;
}

/* The whole page is the game. */
export function HomePage(props: HomePageProps) {
  return (
    <div className="bg-background text-foreground h-svh overflow-hidden">
      <h1 className="sr-only">Rising Tide</h1>
      <main className="relative h-full w-full">
        <GamePanel onPress={props.onPress} />
      </main>
    </div>
  );
}
