import { CardGridSkeleton, PageSkeleton } from "@/components/ui/loading-skeletons";

export default function CatalogLoading(): JSX.Element {
  return (
    <div className="space-y-6" aria-busy>
      <PageSkeleton />
      <CardGridSkeleton cards={12} />
    </div>
  );
}
