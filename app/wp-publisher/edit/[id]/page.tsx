// app/wp-publisher/edit/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ProjectForm from '@/components/ProjectForm';
import type { ProjectConfig } from '@/lib/types';
import { Loader2 } from 'lucide-react';

export default function EditProjectPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setProject(data.project);
      })
      .catch((e) => setError((e as Error).message));
  }, [params.id]);

  return (
    <>
      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold">Edit project</h1>
          <p className="text-white/60 mt-1">{project?.name || params.id}</p>
        </div>
        {error && <div className="text-red-400">{error}</div>}
        {!project && !error && (
          <div className="flex items-center gap-2 text-white/60">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {project && <ProjectForm mode="edit" initial={project} />}
      </main>
    </>
  );
}
