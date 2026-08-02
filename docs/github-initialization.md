# Initialize the empty GitHub repository

The repository currently has no remote commit or `main` branch. GitHub cannot accept a pull request until a base branch exists. The safest initialization is one small web-created commit; Huddle feature work then stays on its feature branch.

## GitHub web instructions

1. Sign in to GitHub and open `https://github.com/marcusmayo/huddle-fantasy-agent`.
2. On the empty-repository page, select **creating a new file**. If the repository page instead shows an **Add file** menu, choose **Create new file**.
3. In the filename field, enter `README.md`.
4. Enter only:

   ```markdown
   # Huddle Fantasy Agent
   ```

5. Select **Commit directly to the `main` branch**.
6. Use the commit message `chore: initialize repository`.
7. Select **Commit new file**.
8. Return to the repository's **Code** page and verify the branch selector says `main` and `README.md` is visible.
9. Do not upload the Huddle source files manually and do not add any API key, `.env`, Yahoo secret, or Cloudflare token.
10. Tell Codex: `The huddle main branch is initialized. You may publish the Huddle feature branch and create the draft PR.`

The connected GitHub App already reports write access to Huddle. No personal access token or password should be pasted into chat. Once `main` exists, Codex can rebase the local feature work onto that base, publish only Huddle changes, and create the authorized draft pull request.
