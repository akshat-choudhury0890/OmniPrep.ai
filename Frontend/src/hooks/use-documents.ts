import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { StudyDocument } from "@/lib/api/types";

export const documentsKey = ["documents"] as const;

export function useDocuments() {
  return useQuery({
    queryKey: documentsKey,
    queryFn: () => api.listDocuments().then((r) => r.documents),
    retry: 1,
    // Poll while the backend is still processing something.
    refetchInterval: (q) => {
      const docs = q.state.data as StudyDocument[] | undefined;
      return docs?.some((d) => d.status === "uploading" || d.status === "processing")
        ? 3000
        : false;
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: (res) => {
      qc.setQueryData<StudyDocument[]>(documentsKey, (old) =>
        old?.filter((d) => d.id !== res.id),
      );
    },
  });
}
