# Campus Loop

Campus Loop is a University of Macau student exchange app built with React, Vite, and Supabase. Its interface is available in English, Traditional Chinese, Simplified Chinese, and European Portuguese. The sample listings and messages are fictional.

## Run locally

Install Node.js 22 or newer, then run these commands from the project folder.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The default local mode uses sample data and saves changes in your browser. It needs no `.env.local` file. Run `npm test` for the discovery and database-policy tests, or `npm run build` for the GitHub Pages build in `dist/`.

## Prepare Supabase

In the Dashboard for the intended Supabase project:

1. Open **SQL Editor** and run the migrations in order. Run the [base schema](supabase/migrations/202611220001_campus_loop.sql) once, then apply [editable meeting places](supabase/migrations/202611230001_editable_handover_location.sql) and [private request replies](supabase/migrations/202611230002_request_replies.sql). On an existing Campus Loop database, run the two new migrations only.
2. Run [`supabase/seed.sql`](supabase/seed.sql). It inserts seven fictional offers and requests. Running the seed again preserves the existing rows.
3. Under **Authentication → Sign In / Providers**, enable **Allow anonymous sign-ins**. Guests get their own Supabase identity. Anyone with the demo link can be a guest, so use only fictional data in the shared demo feed. For a public demo, configure bot protection and usage limits in Supabase before inviting visitors.
4. Copy the **Project URL** and **Publishable key** from the project's **Connect** dialog or **API Keys** settings. The frontend uses the publishable key and Supabase's access policies. Keep secret keys, database passwords, and `service_role` keys out of repository variables and browser code.

## Configure GitHub Pages

1. Create a GitHub repository named `CampusLoop`, or use your existing repository. Upload the **contents** of this folder to the root of its `main` branch, including `.github/workflows/pages.yml` and `package-lock.json`. Keep `node_modules` and `dist` out of the repository.
2. In the repository, open **Settings → Secrets and variables → Actions → Variables → New repository variable**. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using the values from step 4 above. These are read at build time. If you change them, run the workflow again.
3. Open **Settings → Pages** and choose **GitHub Actions** under **Build and deployment → Source**.
4. Go to **Actions → Deploy Campus Loop → Run workflow**, then open the link in the deployment result after it succeeds. For a repository named `CampusLoop`, the project site normally uses `https://<owner>.github.io/CampusLoop/`.

If you are pushing a new local repository from the command line, replace `<owner>` with your GitHub username or organization:

```sh
git init -b main
git add .
git commit -m "Build Campus Loop web app"
git remote add origin https://github.com/<owner>/CampusLoop.git
git push -u origin main
```

## Try the coursework flows

Add one of the following queries to the local URL or the GitHub Pages URL. These scenarios reset on reload and use isolated simulated data for each session.

| URL query | Task and success condition |
| --- | --- |
| `?test=discovery` | Open **Requests**, search for `desk lamp`, and filter to **Study** and **Free**. Open **Free desk lamp for studying** and verify the requester and terms. |
| `?test=recovery` | In **Handover**, open the cancelled handover for **Introduction to Algorithms**. Confirm the book is still with the owner to relist it. The previous conversation remains accessible. |
| `?test=retrieval` | Repeat the second task with the book at the library pickup point. Keep the listing closed until the scenario states that the book has been retrieved, then reopen it. |

To practise a handover, open a sample offer and select **Try a demo handover**. The simulated owner accepts your proposal. From there you can cancel or simulate the owner handing over the item, then confirm receipt. Under **Handover**, **Try the relisting demo** opens a cancelled handover. Open the record to see the previous conversation and relist after retrieving the item. Select **Reset demo** to return to the cancelled handover with the sample listing closed. Changes in these practice flows stay within your browser session.

To answer a request, open it and select **I have one to offer**. The reply is linked to that request and is visible only to the two participants in **Handover → Request replies**. In demo mode, the reply stays in your browser.

The normal Supabase version also supports posting offers and requests, private listings published to **Only me**, pickup dates, times and locations, messages between handover participants, and a two-person handover. To try a shared handover, use one browser profile to publish a shared offer and another to propose a time. Use **Refresh** in the handover views to see the other participant's latest changes.

GitHub Pages setup: [Vite static deployment](https://vite.dev/guide/static-deploy.html#github-pages) and [GitHub Actions variables](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables). Supabase setup: [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) and [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
