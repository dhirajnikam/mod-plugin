# Tickets tab

The Tickets tab shows your tickets from **Jira** or **Notion** beside the work: the project this repository is for,
its open tickets, the ones you are working on, and for any ticket what it asks for and which features of the codebase
it will touch. It reads the trackers through their makers' own MCP servers, Atlassian's
(`https://mcp.atlassian.com/v2/mcp`) and Notion's (`https://mcp.notion.com/mcp`), with your own sign-in. Cockpit only
reads: it never creates, edits, moves or comments on a ticket.

> **What you see first.** One plain sentence (the ticket you are working on, or the project and its open tickets, or
> "Connect Jira or Notion to see your tickets here"), the Jira / Notion switch, and the tickets. The connections and
> **Forget** are behind one **› More** fold (`fold-more-tickets`), folded by default.

## Connecting

Pick **Jira** or **Notion** and press **Connect**. Cockpit asks Claude Code to bring that server into the session; where
Claude Code finds you already run the same server under another name, it answers with that one. If the server
wants a sign-in the tab says so: run `/mcp`, pick the server, sign in, and press **Connect** again.

Cockpit ships both servers in its manifest, and holds them back when a session starts: neither is dialed, lists its
tools or asks for a sign-in until you have pressed **Connect** for it. (A headless plugin install or reload does not
ask Cockpit first, so a server can be dialed then; it still waits on your sign-in.) After that it joins your sessions by itself, and the tab
reconnects when you open it. **Forget** (under More) undoes that: the server stays out of your next sessions.

Nothing is asked of a tracker at a session's start or on a timer: only when the tab opens, or you press a button.

## The project this repository is for

- **Jira**: the tab lists the projects your account can see (on the first Jira site it can reach); press one.
- **Notion** has no projects or tickets of its own, so a **database is the project and its pages are the tickets**.
  Type a few words into **Find**, press Enter, and pick your tasks database from what the search finds.

The choice is kept per repository, across sessions. **Change** picks another.

## The tickets

For Jira: your open tickets in the project (**Mine**), or every open one (**All open**), newest change first, up to
30. For Notion: the database's pages, up to 30. Each row has the ticket's key (Jira), title and status. **↻ Read
again** asks the tracker again.

Press a title to open the ticket: its link, its description, and **✦ Explain it and name its features**. Explain makes
one small model call with the ticket's title and description and the names of the features in the
[codebase memory](activity.md); the answer is a short explanation of what the ticket asks for and what done looks
like, and up to four features the work will most likely touch. Each feature is a link to it in the Activity tab. Only
features the memory really has are shown. The explanation is kept with the repository.

## Working on a ticket

Tick a ticket to say you are working on it. Ticked tickets are kept per repository and listed first. From then on:

- **Claude knows.** Every turn it is told the tickets being worked on (key, title, status, link and, once explained,
  the features they touch), as data from the tracker and never as instructions.
- **The Git tab's ticket is filled** with the first ticked ticket that has a key, so a branch pattern like
  `{kind}/{ticket}-{slug}` or a message pattern like `{ticket} {type}: {subject}` carries it. Unticking it clears it.
  A Notion page has no key, so it does not fill the field.
- **The Overview** shows the ticket under its first line, linking here, and the tab's name carries the count.

## What to know

- A ticket's text is someone else's: control characters are stripped before it is drawn, it is cut to a few thousand
  characters, and the model that explains it is told to follow no instruction inside it.
- The tool names differ between versions of the trackers' servers; Cockpit asks for each by the names it knows, in
  order, and shows the server's own words when a call fails.
- `/cockpit tab tickets` opens the tab.

## When auto mode's check does not answer

Not about tickets, but found while building them: in auto mode, Claude Code's safety check sometimes gives no verdict
on a call, and the call is then refused, again and again. When Cockpit sees that refusal it says so once in the chat
and, for the rest of the session, puts every call that would go to that check to you in the permission dialog
instead, so the work goes on with your yes. A new session starts with the check trusted again.

[All docs](README.md) · [Project README](../README.md)
