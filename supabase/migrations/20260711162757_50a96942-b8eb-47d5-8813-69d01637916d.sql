
CREATE POLICY "own upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'game-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'game-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'game-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
