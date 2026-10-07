/**
 * documentUtils.js
 * Centralized utility functions for normalizing document objects from Google Drive / backend APIs
 * and computing consistent counts across Documents, Overview, and App components.
 */

/**
 * Deduplicate and normalize documents list so that each document has uniform fields,
 * consistent extraction & review statuses, and verified counts.
 */
export function normalizeDocumentList(documents = [], driveState = {}, currentUserName = 'Reviewer') {
  if (!documents || documents.length === 0) {
    return [];
  }

  // Deduplicate by normalized document name to ensure every document appears at most ONCE
  const uniqueMap = new Map();
  documents.forEach((d, idx) => {
    const nameKey = (d.name || d.fileName || '').trim().toLowerCase();
    if (!nameKey) {
      uniqueMap.set(String(d.id || d.document_id || idx), d);
      return;
    }
    if (!uniqueMap.has(nameKey)) {
      uniqueMap.set(nameKey, d);
    } else {
      const existing = uniqueMap.get(nameKey);
      const existingStatus = (existing.extraction_status || existing.extractionStatus || '').toLowerCase();
      const newStatus = (d.extraction_status || d.extractionStatus || '').toLowerCase();
      const existingPublished = existingStatus === 'published' || existing.review_status === 'published' || existing.isPublished;
      const newPublished = newStatus === 'published' || d.review_status === 'published' || d.isPublished;
      const existingClassified = existingStatus === 'classified' || Boolean(existing.stages?.classification || existing.classified);
      const newClassified = newStatus === 'classified' || Boolean(d.stages?.classification || d.classified);

      if (newPublished && !existingPublished) {
        uniqueMap.set(nameKey, d);
      } else if (existingPublished && !newPublished) {
        // Keep the published document and its current extraction status
      } else if (!existingClassified && newClassified) {
        uniqueMap.set(nameKey, d);
      } else if (existingClassified && !newClassified) {
        // Keep existing classified document
      } else {
        const existingPages = existing.pages ?? existing.stages?.extraction?.pages ?? 0;
        const newPages = d.pages ?? d.stages?.extraction?.pages ?? 0;
        const isExistingExtracted = existingStatus === 'extracted' || existingStatus === 'extracted_with_warnings';
        const isNewExtracted = newStatus === 'extracted' || newStatus === 'extracted_with_warnings';
        if (!isExistingExtracted && isNewExtracted) {
          uniqueMap.set(nameKey, d);
        } else if (newPages > existingPages) {
          uniqueMap.set(nameKey, d);
        }
      }
    }
  });

  const uniqueDocs = Array.from(uniqueMap.values());

  return uniqueDocs.map((d, i) => {
    const extraction = d.stages?.extraction;
    const classification = d.stages?.classification;
    const pages = d.pages ?? extraction?.pages ?? 0;
    const clauses = d.clauses ?? extraction?.clauses ?? 0;
    const paragraphs = d.paragraphs ?? extraction?.paragraphs ?? 0;
    const rawExtractionStatus = (
      d.extraction_status ||
      d.extractionStatus ||
      extraction?.status ||
      'pending'
    ).toLowerCase();

    const isClassified =
      rawExtractionStatus === 'classified' ||
      (d.status && String(d.status).toLowerCase() === 'classified') ||
      d.classified === true ||
      Boolean(
        classification &&
          (classification.status === 'succeeded' ||
            (classification.micro_chunks && classification.micro_chunks > 0) ||
            classification.id)
      );

    const extractionStatus =
      rawExtractionStatus === 'published'
        ? 'published'
        : isClassified
        ? 'classified'
        : rawExtractionStatus;

    const needsReview = d.needsReview ?? classification?.needs_review ?? null;
    const warnings = d.warnings || extraction?.warnings || [];
    const size = d.size || (pages > 0 ? `${Math.max(12, Math.round(pages * 26.5))} KB` : '24 KB');
    const currentReviewer =
      d.current_reviewer !== undefined
        ? d.current_reviewer
        : d.rawDoc?.current_reviewer !== undefined
        ? d.rawDoc.current_reviewer
        : null;

    // Persistent list of all users who saved edits
    const reviewers = d.reviewers || d.rawDoc?.reviewers || [];

    // Derive document status
    const status =
      d.status === 'Saved' || d.isSaved
        ? 'Saved'
        : d.status ||
          (currentReviewer
            ? 'In review'
            : isClassified
            ? needsReview > 0
              ? 'Needs review'
              : 'Reviewed'
            : extractionStatus === 'extracted'
            ? needsReview > 0
              ? 'Needs review'
              : 'Reviewed'
            : extractionStatus === 'extracted_with_warnings'
            ? 'Needs review'
            : extractionStatus === 'rejected'
            ? 'Draft'
            : 'Needs review');

    return {
      id: d.id || d.document_id || `doc-${i}`,
      documentId: d.document_id || d.id || `doc-${i}`,
      name: d.name || 'Untitled Document',
      fileName: d.name || 'document.docx',
      title: d.title || d.name,
      agreement_type:
        d.agreement_type ||
        d.agreementType ||
        d.rawDoc?.agreement_type ||
        d.rawDoc?.metadata?.agreement_type ||
        '',
      sectorial_category:
        d.sectorial_category ||
        d.sectorial ||
        d.rawDoc?.sectorial_category ||
        d.rawDoc?.metadata?.sectorial_category ||
        '',
      agreementType:
        d.agreement_type ||
        d.agreementType ||
        d.rawDoc?.agreement_type ||
        d.rawDoc?.metadata?.agreement_type ||
        '',
      sectorial:
        d.sectorial_category ||
        d.sectorial ||
        d.rawDoc?.sectorial_category ||
        d.rawDoc?.metadata?.sectorial_category ||
        '',
      pages,
      clauses,
      paragraphs,
      size,
      extractionStatus,
      needsReview,
      warnings,
      stages: d.stages || {},
      current_reviewer: currentReviewer,
      currentReviewer,
      reviewers,
      status,
      statusTag:
        d.statusTag ||
        (warnings.length > 0 ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : null),
      vectorDbStatus: d.vectorDbStatus || 'Not sent yet',
      vectorDbDetail: d.vectorDbDetail || '',
      parties:
        d.parties ||
        (d.folder || driveState.folderPath
          ? `Folder: ${d.folder || driveState.folderPath}`
          : 'Parties to Agreement'),
      inDriveSince:
        d.inDriveSince ||
        (d.last_extracted_at
          ? new Date(d.last_extracted_at).toLocaleDateString()
          : d.modifiedTime || 'Recently'),
      reviewer:
        currentReviewer ||
        d.reviewer ||
        currentUserName ||
        driveState.user?.name ||
        driveState.user?.email ||
        'Reviewer',
      lastSaved:
        d.lastSaved ||
        (d.last_extracted_at
          ? new Date(d.last_extracted_at).toLocaleDateString()
          : d.modifiedTime || 'Today'),
      lastExtracted:
        d.lastExtracted ||
        (d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleString() : null),
      folder: d.folder || driveState.folderPath || 'Google Drive',
      issues: d.issues || {
        duplicateParaId: 0,
        canonicalTypeMissing: needsReview ?? 0,
        paragraphsToReview:
          needsReview ?? (paragraphs - clauses > 0 ? paragraphs - clauses : 0),
        warnings,
      },
      recentActivity: d.recentActivity || {
        user: driveState.user?.name || 'System',
        action: isClassified
          ? 'Pipeline classification completed'
          : extractionStatus === 'extracted'
          ? 'Last extraction completed'
          : extractionStatus === 'rejected'
          ? 'Document rejected by parser'
          : 'File ready from Google Drive',
        timestamp:
          d.modifiedTime ||
          (d.last_extracted_at ? new Date(d.last_extracted_at).toLocaleDateString() : 'Today'),
      },
      webViewLink: d.webViewLink || d.drive_web_link,
      rawDoc: d.rawDoc || d,
    };
  });
}

/**
 * Computes exact count metrics for document filter chips and overview metrics.
 */
export function computeDocumentCounts(allDocs = []) {
  if (!allDocs || allDocs.length === 0) {
    return {
      all: 0,
      needsReview: 0,
      inReview: 0,
      draft: 0,
      indraft: 0,
      saved: 0,
      reviewed: 0,
      inreviewed: 0,
      published: 0,
      extracted: 0,
      warnings: 0,
      rejected: 0,
      updated: 0,
    };
  }

  const draftCount = allDocs.filter(
    (d) => d.status === 'Draft' || d.extractionStatus === 'rejected'
  ).length;

  const reviewedCount = allDocs.filter((d) => d.status === 'Reviewed').length;

  const publishedCount = allDocs.filter(
    (d) =>
      d.status === 'Published' ||
      d.status === 'Updated to vector DB' ||
      d.review_status === 'published' ||
      (d.vectorDbStatus &&
        (d.vectorDbStatus.startsWith('Updated') || d.vectorDbStatus === 'Published')) ||
      d.isPublished
  ).length;

  const needsReviewCount = allDocs.filter(
    (d) => (d.needsReview && d.needsReview > 0) || d.status === 'Needs review'
  ).length;

  const inReviewCount = allDocs.filter(
    (d) => d.status === 'In review' || Boolean(d.current_reviewer)
  ).length;

  return {
    all: allDocs.length,
    needsReview: needsReviewCount,
    inReview: inReviewCount,
    draft: draftCount,
    indraft: draftCount,
    saved: allDocs.filter((d) => d.status === 'Saved').length,
    reviewed: reviewedCount,
    inreviewed: reviewedCount,
    published: publishedCount,
    extracted: allDocs.filter((d) => d.extractionStatus === 'extracted').length,
    warnings: allDocs.filter(
      (d) => d.extractionStatus === 'extracted_with_warnings' || (d.warnings && d.warnings.length > 0)
    ).length,
    rejected: allDocs.filter((d) => d.extractionStatus === 'rejected').length,
    updated: publishedCount,
  };
}
