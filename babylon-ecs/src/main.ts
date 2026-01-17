import { Game } from "./core/Game";
import "./style.css";

/**
 * Application Entry Point
 * Simple and clean - just bootstraps the game
 */
const canvas = document.getElementById("app") as HTMLCanvasElement;

if (!canvas) {
    throw new Error("Canvas element with id 'app' not found");
}

const game = new Game(canvas);

game.initialize().then(() => {
    game.start();
});
