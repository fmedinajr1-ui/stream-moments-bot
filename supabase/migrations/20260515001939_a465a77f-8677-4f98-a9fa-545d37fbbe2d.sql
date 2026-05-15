ALTER TABLE public.marked_moments
  ADD CONSTRAINT marked_moments_source_id_fkey
  FOREIGN KEY (source_id) REFERENCES public.sources(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_marked_moments_source_id ON public.marked_moments(source_id);
CREATE INDEX IF NOT EXISTS idx_marked_moments_status ON public.marked_moments(status);