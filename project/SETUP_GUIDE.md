# Sweet Messaging App - Setup Guide

## Prerequisites
- Node.js 16+ and npm
- A Supabase account (free tier available)
- A modern web browser

## Step 1: Clone/Setup Project

```bash
cd /tmp/cc-agent/64518192/project
npm install
```

## Step 2: Configure Supabase

1. Go to [Supabase](https://supabase.com) and create a new project
2. Once created, go to Settings → API Keys
3. Copy your `Project URL` and `Anon Key`

## Step 3: Set Environment Variables

Create/update `.env` file in the project root:

```
VITE_SUPABASE_URL=your_project_url_here
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

Example:
```
VITE_SUPABASE_URL=https://abcdef.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

## Step 4: Setup Database

The database migrations have already been created. When you first connect to Supabase, they will automatically create:

- All required tables (profiles, chats, messages, etc.)
- Row Level Security policies
- Indexes for performance
- Triggers for timestamps

## Step 5: Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173` (or the port shown in terminal)

## Step 6: Create Your Account

1. Click "Sign Up"
2. Enter email, username, display name, password
3. Username must contain only: A-Z, a-z, 0-9, -, _
4. Create account - a "Saved Messages" chat will be auto-created
5. You're ready to use Sweet!

## Step 7: Add Friends

1. Click "Friends" button in the chat list
2. Go to "Search" tab
3. Search for another user by username
4. Click "+" to send friend request
5. Once accepted, click the message icon to start chatting

## Test Account Setup

To test with multiple accounts:

1. Open app in regular window → Sign up as User 1
2. Open app in private/incognito window → Sign up as User 2
3. Both users can search for each other and start chatting

## Project Structure

```
project/
├── src/
│   ├── components/          # Reusable UI components
│   ├── pages/              # Full page components
│   ├── contexts/           # React context (Auth)
│   ├── lib/                # Utility functions & Supabase client
│   ├── App.tsx             # Main app component
│   ├── main.tsx            # Entry point
│   ├── index.css           # Global styles
│   └── vite-env.d.ts       # Vite types
├── supabase/
│   └── migrations/         # Database migrations
├── public/                 # Static assets
├── .env                    # Environment variables
├── vite.config.ts          # Vite configuration
├── tsconfig.json           # TypeScript configuration
└── tailwind.config.js      # Tailwind CSS configuration
```

## Key Features

### Authentication
- Email/password signup and login
- Username validation (A-Z, a-z, 0-9, -, _)
- Real-time availability checking
- Password strength indicator
- Secure session management

### Messaging
- Real-time message delivery
- Typing indicators
- Message reactions (❤️ 👍 😆 😢 🔥)
- Message deletion
- Message retry on failure
- Delivery status tracking

### Friends
- Add/remove friends
- Friend request system
- Search by username
- Online status tracking
- Last seen timestamp

### Chat
- 1-to-1 messaging
- Online/offline indicators
- Mute chat feature
- Search messages
- Clear chat history
- Theme selection

### Settings
- Edit profile & bio
- Change username
- Privacy settings
- Notification controls
- Theme customization
- Storage management

## Troubleshooting

### App won't load
- Check that `.env` file has correct Supabase credentials
- Ensure Supabase project is active
- Check browser console for errors (F12)

### Can't send messages
- Verify both users are friends
- Check chat is loaded (look for chat header)
- Ensure you have an active internet connection
- Check Supabase is responding (visit Supabase dashboard)

### Messages not updating in real-time
- Refresh the page
- Check browser console for WebSocket errors
- Verify Supabase realtime is enabled
- Try clearing browser cache

### Friend requests not showing
- Refresh the page
- Check both usernames are correct
- Verify users are not blocked

### Database errors
- Check Supabase project status
- Verify RLS policies are applied (in Supabase dashboard)
- Check that migrations ran successfully

## Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview

# Type check
npm run typecheck

# Lint code
npm run lint
```

## Production Deployment

### Build
```bash
npm run build
```

This creates optimized files in the `dist/` folder.

### Deploy to Vercel
```bash
npm install -g vercel
vercel
```

### Deploy to Netlify
```bash
npm run build
# Drag dist/ folder to Netlify
```

### Deploy to Other Platforms
- Set environment variables for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Deploy the `dist/` folder
- Ensure CORS is configured in Supabase (Settings → CORS)

## Environment Variable Reference

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anonymous key |

## Security Notes

- Never commit `.env` to version control
- Keep your Anon Key private (it's only for client use)
- Use Row Level Security policies (already configured)
- All passwords are handled by Supabase Auth
- Messages are stored in the database (future: add encryption)

## Browser Support

- Chrome/Edge: Latest versions
- Firefox: Latest versions
- Safari: Latest versions
- Mobile browsers: Not optimized (yet)

## Next Steps

1. Customize the color scheme in `tailwind.config.js`
2. Add your own logo/branding
3. Deploy to production
4. Share with friends!

## Support

For issues:
1. Check the browser console (F12)
2. Review Supabase logs in the dashboard
3. Check database tables are created in Supabase
4. Verify RLS policies are enabled

## Additional Resources

- [Supabase Docs](https://supabase.com/docs)
- [React Docs](https://react.dev)
- [Tailwind Docs](https://tailwindcss.com)
- [Vite Docs](https://vitejs.dev)
