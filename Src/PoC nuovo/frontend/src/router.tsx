import { createRouter, RouterProvider } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { useAppStore } from './stores/useAppStore';

const router = createRouter({
  routeTree,
  context: { store: null! },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  defaultErrorComponent: ({ error }) => <div>{error.message}</div>,
});

export const Router = () => {
  const store = useAppStore();
  return <RouterProvider router={router} context={{ store }} />;
};