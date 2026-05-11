import {
  CardGridSkeleton,
  FilterBarSkeleton,
  PageSkeleton,
} from "@/components/ui/loading-skeletons";

export default function CategoryLoading(): JSX.Element {
  return (
    <div className="space-y-6" aria-busy>
      <PageSkeleton />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <FilterBarSkeleton items={5} />
        </div>
        <CardGridSkeleton cards={9} />
      </div>
    </div>
  );
}
