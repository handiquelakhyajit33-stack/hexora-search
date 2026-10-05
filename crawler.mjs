async function savePage({ originalUrl, finalUrl, parsed, contentHash, r2Key, statusCode }) {
  const client = await pool.connect();

  try {
    console.log(`[HEXORA] DB save starting: ${originalUrl}`);

    await client.query("BEGIN");

    const page = await client.query(
      `INSERT INTO pages
       (
         url,
         canonical_url,
         title,
         description,
         excerpt,
         content,
         domain,
         language,
         content_hash,
         word_count,
         status_code,
         crawl_status,
         last_crawled_at,
         updated_at,
         published_at,
         r2_key,
         quality_score,
         image_items,
         video_items
       )
       VALUES
       (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,NOW(),NOW(),$13,$14,$15,$16,$17
       )
       ON CONFLICT (url) DO UPDATE SET
         canonical_url = EXCLUDED.canonical_url,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         excerpt = EXCLUDED.excerpt,
         content = EXCLUDED.content,
         domain = EXCLUDED.domain,
         language = EXCLUDED.language,
         content_hash = EXCLUDED.content_hash,
         word_count = EXCLUDED.word_count,
         status_code = EXCLUDED.status_code,
         crawl_status = EXCLUDED.crawl_status,
         last_crawled_at = NOW(),
         updated_at = NOW(),
         published_at = EXCLUDED.published_at,
         r2_key = EXCLUDED.r2_key,
         quality_score = EXCLUDED.quality_score,
         image_items = EXCLUDED.image_items,
         video_items = EXCLUDED.video_items
       RETURNING id`,
      [
        originalUrl,
        parsed.canonical || finalUrl,
        parsed.title,
        parsed.description,
        parsed.content.slice(0, 800),
        parsed.content,
        domainOf(parsed.canonical || finalUrl),
        parsed.language,
        contentHash,
        parsed.wordCount,
        statusCode,
        parsed.crawlStatus,
        parsed.publishedAt,
        r2Key,
        parsed.qualityScore,
        JSON.stringify(parsed.imageItems || []),
        JSON.stringify(parsed.videoItems || []),
      ]
    );

    const pageId = page.rows[0]?.id;

    if (!pageId) {
      throw new Error("pages INSERT returned no page id");
    }

    console.log(`[HEXORA] Page saved: ${pageId} ${originalUrl}`);

    await client.query(
      "DELETE FROM page_links WHERE source_page_id = $1",
      [pageId]
    );

    for (const link of parsed.links.slice(0, MAX_LINKS)) {
      await client.query(
        `INSERT INTO page_links
         (source_page_id, target_url, anchor_text)
         VALUES ($1,$2,$3)
         ON CONFLICT (source_page_id,target_url)
         DO UPDATE SET anchor_text = EXCLUDED.anchor_text`,
        [pageId, link.url, link.anchor]
      );

      await client.query(
        `INSERT INTO crawl_queue
         (url,status,priority,discovered_from)
         VALUES ($1,'pending',$2,$3)
         ON CONFLICT (url) DO NOTHING`,
        [
          link.url,
          Math.max(1, Math.min(100, 40 + (link.anchor ? 10 : 0))),
          finalUrl,
        ]
      );
    }

    const domain = domainOf(parsed.canonical || finalUrl);

    await client.query(
      `UPDATE domains
       SET pages_count = pages_count + 1,
           updated_at = NOW()
       WHERE domain = $1`,
      [domain]
    ).catch(() => {});

    await client.query("COMMIT");

    console.log(
      `[HEXORA] DB save completed: page=${pageId} links=${parsed.links.length}`
    );

    return pageId;

  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error(
      `[HEXORA] DB save failed for ${originalUrl}:`,
      error?.message || error
    );

    throw error;

  } finally {
    client.release();
  }
}
