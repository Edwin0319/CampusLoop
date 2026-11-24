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

1. Open **SQL Editor** and run the migrations in order. Run the [base schema](supabase/migrations/202611220001_campus_loop.sql) once, then apply [editable meeting places](supabase/migrations/202611230001_editable_handover_location.sql), [private request replies](supabase/migrations/202611230002_request_replies.sql), [multiple listing categories](supabase/migrations/202611230003_listing_categories.sql), [listing deletion](supabase/migrations/202611230004_delete_listing.sql), [withdrawing request replies](supabase/migrations/202611230005_withdraw_request_reply.sql), [college-only audience](supabase/migrations/202611230006_college_audience.sql), and [Report 3 alignment](supabase/migrations/202611230007_report3_alignment.sql) (five-level condition scale, in-person handovers, shared handover terms, and dropping expired pickup times on relisting). On an existing Campus Loop database, apply the migrations that are still pending.
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
| `?test=recovery` | In **Inbox → Handovers**, open the cancelled handover for **Introduction to Algorithms**. Confirm the book is still with the owner to relist it. The previous conversation remains accessible. |
| `?test=retrieval` | Repeat the second task with the book at the library pickup point. Keep the listing closed until the scenario states that the book has been retrieved, then reopen it. |

The GitHub Pages site opens with the shared Supabase data, where the **Simulate …** buttons are hidden. To use the local demo there instead, with all simulate buttons, choose **Local demo · Saved in this browser** in the **Data** menu at the top of the page. The browser remembers this choice, so later visits and reloads open the same mode. Each mode keeps its own data, so switching back and forth does not delete anything. Opening the site with `?demo=local` or `?demo=cloud` also sets the choice, for example in a link you give to testers. When you run the app locally without a `.env` file, only the local demo is available and the menu is not shown.

To practise a handover, open a sample offer and select **Try a demo handover**. The simulated owner accepts your proposal. From there you can cancel, or simulate the owner handing the item to you in person or leaving it at the pickup point, then confirm receipt. In the default local mode, the demo handover stays on the same page and is saved in **Inbox → Handovers** with your other data; in the Supabase version it opens the separate `?test=handover` page. To practise relisting from the normal homepage, go to **Inbox → Handovers** and open the cancelled sample *Introduction to Algorithms*. **Reset demo** in **Inbox** closes the sample listing again and, in local mode, removes demo handovers and replies to sample requests, and makes the sample offers available again. Your own listings are not changed.

To answer a request, open it and select **I have one to offer**. The reply is linked to that request and is visible only to the two participants in **Inbox → Request replies**. The sender can withdraw it with **Withdraw offer** and a second confirmation; the requester then no longer sees it. In demo mode, the reply stays in your browser until you withdraw it or select **Reset demo**. To practise what happens next in the default local mode, open the reply in **Inbox → Request replies** and select **Simulate the requester accepting**. Then choose **Arrange time and place**; the simulated requester agrees to it. On the handover page you are the giver: **I’ve left the item at the pickup point**, then **Simulate the requester confirming receipt** to complete it. You can also send messages or cancel. Once a reply is part of a handover it can no longer be withdrawn; cancel the handover instead. In the Supabase version, requesters cannot yet accept replies.

To see how others respond to your own post in the default local mode, open the post after publishing it. A shared offer shows **Simulate someone wanting this item**: a simulated student proposes a time and place, which you can accept, then leave the item at the pickup point and simulate the other person confirming receipt. A shared request shows **Simulate someone having this item**: a simulated student replies, and you can **Accept this offer**, arrange a time and place, simulate the other person leaving the item, and confirm receipt. Posts visible only to you cannot receive simulated responses. **Reset demo** removes these demo handovers and replies and makes your posts available again.

When posting, choose who can see the post under **Who can see this?**: **UM students** (the shared feed), **Students in my college**, or **Only me**. A college-only post is shown only to people who chose the same residential college under **My residential college**, which you can set on the post form or in **My listings**. The college is self-declared and not verified. To see a college-only post from the other side, choose **Cheng Yu Tung College** as your college: the sample offer *Electric kettle for the floor pantry* then appears in **Discover** with a *Cheng Yu Tung College only* label, and disappears again if you choose another college. In the Supabase version this sample is added by the college-only audience migration.

To delete one of your own listings, open **My listings**, select **Delete listing**, and confirm with **Delete permanently**. Deletion is blocked while a handover is in progress, and it also removes the listing's past handovers, messages and request replies. Closed listings can be deleted too. Deleting the sample *Introduction to Algorithms* only hides it in this browser; **Reset demo** in **Inbox** brings it back.

The normal Supabase version also supports posting offers and requests, private listings published to **Only me**, pickup dates, times and locations, messages between handover participants, and a two-person handover. To try a shared handover, use one browser profile to publish a shared offer and another to propose a time. Use **Refresh** in the handover views to see the other participant's latest changes.

GitHub Pages setup: [Vite static deployment](https://vite.dev/guide/static-deploy.html#github-pages) and [GitHub Actions variables](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables). Supabase setup: [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) and [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
