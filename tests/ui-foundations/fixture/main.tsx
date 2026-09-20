import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { PublicFixture } from "./public-pages";
import { BenchmarkReview } from "./benchmark-review";
import { EnterpriseContactDialog } from "@/components/EnterpriseContactDialog";
import { Button } from "@/components/ui/button";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import "./styles.css";

const longName = "Project_" + "長い名前".repeat(30);
const detail =
  "Review this synthetic example carefully. It exercises long content without contacting any account or provider. ".repeat(
    18,
  ) + longName;
const cancelLabel = "Cancel and keep my current project settings";
const confirmLabel = "Confirm changes to the selected project only";

function Fixture() {
  const standaloneReview = document.documentElement.dataset.kovaReview === "1";
  const surface =
    new URLSearchParams(location.search).get("surface") ??
    (standaloneReview ? "public-overview" : "dialog");
  const [result, setResult] = useState("No action taken");
  const [mobileOpen, setMobileOpen] = useState(false);
  const trigger = <Button data-testid="trigger">Open example</Button>;
  const onConfirm = () => setResult("Confirmed once");
  const side = surface.replace("sheet-", "") as "top" | "bottom" | "left" | "right";
  if (
    surface.startsWith("public-") &&
    (standaloneReview || new URLSearchParams(location.search).get("review") === "1")
  )
    return <BenchmarkReview initialSurface={surface} />;
  if (surface.startsWith("public-")) return <PublicFixture surface={surface} />;
  if (surface === "enterprise")
    return (
      <main className="fixture-page">
        <Button data-testid="trigger" onClick={() => setMobileOpen(true)}>
          Contact sales
        </Button>
        <EnterpriseContactDialog open={mobileOpen} onOpenChange={setMobileOpen} />
      </main>
    );
  return (
    <main className="fixture-page">
      <h1 className="mb-4 text-lg font-semibold">Shared interface verification</h1>
      <p role="status">{result}</p>
      {surface.startsWith("mobile") ? (
        <>
          <Button data-testid="trigger" onClick={() => setMobileOpen(true)}>
            Open example
          </Button>
          <MobileBottomSheet open={mobileOpen} onOpenChange={setMobileOpen} title="Choose a tool">
            <div className="min-w-0 space-y-4 p-4">
              <button hidden>Hidden action</button>
              {surface === "mobile-nested" ? (
                <Select defaultValue="initial" onValueChange={setResult}>
                  <SelectTrigger aria-label="Choose a nested project">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[110]" data-testid="nested-select">
                    <SelectItem value="initial">Initial project</SelectItem>
                    <SelectItem value="other">Other project</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p>{detail}</p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setMobileOpen(false)}>
                  {cancelLabel}
                </Button>
                <Button
                  onClick={() => {
                    onConfirm();
                    setMobileOpen(false);
                  }}
                >
                  {confirmLabel}
                </Button>
              </DialogFooter>
            </div>
          </MobileBottomSheet>
        </>
      ) : surface === "dialog" ? (
        <Dialog>
          <DialogTrigger asChild>{trigger}</DialogTrigger>
          <DialogContent data-testid="surface">
            <DialogHeader>
              <DialogTitle>Review project changes</DialogTitle>
              <DialogDescription>{detail}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{cancelLabel}</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button onClick={onConfirm}>{confirmLabel}</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : surface === "alert" ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
          <AlertDialogContent data-testid="surface">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm project changes</AlertDialogTitle>
              <AlertDialogDescription>{detail}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
              <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : surface.startsWith("sheet-") ? (
        <Sheet>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent side={side} data-testid="surface">
            <SheetHeader>
              <SheetTitle>Project information</SheetTitle>
              <SheetDescription>{detail}</SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="outline">{cancelLabel}</Button>
              </SheetClose>
              <SheetClose asChild>
                <Button onClick={onConfirm}>{confirmLabel}</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : surface === "select" ? (
        <Select defaultValue="initial" onValueChange={setResult}>
          <SelectTrigger data-testid="trigger" aria-label="Choose a project">
            <SelectValue />
          </SelectTrigger>
          <SelectContent data-testid="surface">
            <SelectItem value="initial">Choose an example project</SelectItem>
            <SelectItem value="long">{longName}</SelectItem>
            {Array.from({ length: 20 }, (_, i) => (
              <SelectItem key={i} value={`project-${i}`}>
                Example project {i + 1}
              </SelectItem>
            ))}
            <SelectItem value="final">Final project</SelectItem>
          </SelectContent>
        </Select>
      ) : surface === "popover" ? (
        <Popover>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent data-testid="surface" aria-label="Project details">
            <p>{detail}</p>
            <Button onClick={onConfirm}>Apply</Button>
          </PopoverContent>
        </Popover>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent data-testid="surface">
            <DropdownMenuItem>First action</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More project actions</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-testid="nested-surface">
                <DropdownMenuItem onSelect={onConfirm}>Apply nested action</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {Array.from({ length: 15 }, (_, i) => (
              <DropdownMenuItem key={i}>Action {i + 1}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button className="mt-4" data-testid="outside">
        Outside action
      </Button>
    </main>
  );
}

const rootRoute = createRootRoute({ component: Fixture });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
const overviewRoute = createRoute({ getParentRoute: () => rootRoute, path: "/overview" });
const pricingRoute = createRoute({ getParentRoute: () => rootRoute, path: "/pricing" });
const initialSurface = new URLSearchParams(location.search).get("surface");
const initialRoute =
  initialSurface === "public-comparison"
    ? "/pricing"
    : initialSurface === "public-overview"
      ? "/overview"
      : "/";
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, overviewRoute, pricingRoute]),
  history: createMemoryHistory({ initialEntries: [initialRoute] }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
