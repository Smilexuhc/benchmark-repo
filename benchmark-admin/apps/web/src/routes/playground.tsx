import { PlaygroundPage } from '@/components/playground/PlaygroundPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/playground')({
  component: PlaygroundPage,
});
