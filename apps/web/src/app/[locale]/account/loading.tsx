import { DetailSkeleton, PageSkeleton } from "@/components/ui/loading-skeletons";

export default function AccountLoading(): JSX.Element {
  return (
    <div className="space-y-6" aria-busy>
      <PageSkeleton />
      <DetailSkeleton />
    </div>
  );
}
