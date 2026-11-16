import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { AdminNav } from "~/components/AdminNav";
import { HydrateMarker } from "~/components/HydrateMarker";
import "~/styles/global.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { title: "Form:at Admin" },
      { name: "robots", content: "noindex" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
  }),
  component: Root,
});

function Root() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-black text-white font-mono antialiased min-h-dvh flex flex-col">
        <HydrateMarker />
        <AdminNav />
        <main className="flex-1">
          <Outlet />
        </main>
        <Scripts />
      </body>
    </html>
  );
}
