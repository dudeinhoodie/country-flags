-- The public site's documents (ADR-023): the privacy policy, the terms and
-- any other page the app links to, edited in the console per locale.
--
-- A document row is the draft; a version row is one publication of it,
-- immutable and numbered per document. `published_version_id` says which
-- version the site serves. The site itself never reads these tables — a
-- publish exports a static snapshot into the site bucket — so a page keeps
-- answering while the API is down, which is the property the old GitHub
-- Pages home had and the one a shipped link must keep.

-- CreateTable
CREATE TABLE "public"."site_documents" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "published_version_id" UUID,
    "created_by_admin_user_id" UUID NOT NULL,
    "updated_by_admin_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."site_document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "note" TEXT,
    "published_by_admin_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_documents_published_version_id_key" ON "public"."site_documents"("published_version_id");

-- One page per address and language: the slug is the path on the site.
-- CreateIndex
CREATE UNIQUE INDEX "site_documents_slug_locale_key" ON "public"."site_documents"("slug", "locale");

-- Version numbers are per document and never reused.
-- CreateIndex
CREATE UNIQUE INDEX "site_document_versions_document_id_version_key" ON "public"."site_document_versions"("document_id", "version");

-- AddForeignKey
ALTER TABLE "public"."site_documents" ADD CONSTRAINT "site_documents_created_by_admin_user_id_fkey" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."site_documents" ADD CONSTRAINT "site_documents_updated_by_admin_user_id_fkey" FOREIGN KEY ("updated_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."site_documents" ADD CONSTRAINT "site_documents_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "public"."site_document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."site_document_versions" ADD CONSTRAINT "site_document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."site_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."site_document_versions" ADD CONSTRAINT "site_document_versions_published_by_admin_user_id_fkey" FOREIGN KEY ("published_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
