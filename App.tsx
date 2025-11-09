


import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './services/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { Header } from './components/Header';
import { LiveConversation } from './components/LiveConversation';
import { TextToSpeech } from './components/TextToSpeech';
import { LowLatencyChat } from './components/LowLatencyChat';
import { Basket } from './components/Basket';
import { Auth } from './components/auth/Auth';
import { PricingModal } from './components/PricingModal';
import { BitPayCheckout } from './components/BitPayCheckout';
import { CookieConsent } from './components/CookieConsent';

export type ActiveTab = 'live' | 'tts' | 'chat';
export type SubscriptionTier = 'Free' | 'Basic' | 'Standard' | 'Premium' | 'Admin';

export interface ChatMessage {
  id?: string;
  role: 'user' | 'model';
  content: string;
  created_at?: string;
  user_id?: string;
}

export interface AiProfileInfo {
  [key:string]: string | undefined;
  Name: string;
  Location: string;
  Interests: string;
  language?: string;
}

export interface UserData {
  tier: SubscriptionTier;
  points: number;
  is_admin: boolean;
  ai_profile_info: AiProfileInfo;
  basket_items: string[];
}

export interface CurrentUser extends UserData {
  id: string;
  email: string | null;
  language: string;
}

export interface TierInfo {
    name: SubscriptionTier;
    price: string;
    points: number;
}

const initialMessage: ChatMessage = { role: 'model', content: "Hi there! I'm Padi. Please sign in or create an account to start chatting." };

const POINTS_CONFIG = {
  liveConversationStart: 50,
  textToSpeechChar: 1,
  lowLatencyMessage: 5,
};

// Add new admin emails here
const ADMIN_EMAILS = [
  'samfolarvic@gmail.com',
  'test@example.dev',
  'super@user.com'
].map(email => email.toLowerCase());

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('live');
  const [isBasketOpen, setIsBasketOpen] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [selectedTierForCheckout, setSelectedTierForCheckout] = useState<TierInfo | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [showCookieConsent, setShowCookieConsent] = useState(false);
  const currentUserId = currentUser?.id;

  // Effect 1: Handle Auth State and Basic User Info (Fast)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      if (user) {
        setCurrentUser(prev => ({
          ...(prev || {
            tier: 'Free',
            points: 0,
            is_admin: false,
            ai_profile_info: { Name: 'Padi', Location: 'the cloud', Interests: 'learning new things and chatting', language: 'English' },
            basket_items: [],
          }),
          id: user.id,
          email: user.email,
          language: prev?.language || 'English',
        }));
      } else {
        setCurrentUser(null);
      }
      setAuthChecked(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Effect 2: Fetch Full Profile Data (In Background)
  useEffect(() => {
    if (currentUserId) {
        const fetchAndHydrateProfile = async () => {
            const user = (await supabase.auth.getUser()).data.user;
            if (!user) return;

            try {
                let { data: profile, error } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single();
                
                if (profile) {
                    const defaultProfileInfo = { Name: 'Padi', Location: 'the cloud', Interests: 'learning new things and chatting' };
                    let currentProfileInfo = profile.ai_profile_info || {};
                    const needsUpdate = !currentProfileInfo.Name || !currentProfileInfo.Location || !currentProfileInfo.Interests || !currentProfileInfo.language;

                    if (needsUpdate) {
                        const updatedAiInfo = { 
                            ...defaultProfileInfo, 
                            ...currentProfileInfo,
                            language: currentProfileInfo.language || 'English'
                        };
                        const { data: updatedProfile, error: updateError } = await supabase
                            .from('profiles')
                            .update({ ai_profile_info: updatedAiInfo })
                            .eq('id', user.id)
                            .select()
                            .single();
                        if (updateError) console.error("Error back-filling profile:", updateError.message || updateError);
                        profile = updatedProfile || { ...profile, ai_profile_info: updatedAiInfo };
                    }
                    setCurrentUser({ ...profile, email: user.email, language: profile.ai_profile_info?.language || 'English' });
                } else {
                    const isAdmin = ADMIN_EMAILS.includes(user.email?.toLowerCase() || '');
                    const newUserProfile = {
                        id: user.id,
                        tier: isAdmin ? 'Admin' : 'Free' as SubscriptionTier,
                        points: 5000,
                        is_admin: isAdmin,
                        ai_profile_info: { Name: 'Padi', Location: 'the cloud', Interests: 'learning new things and chatting', language: 'English' },
                        basket_items: [],
                    };
                    const { data: newProfile, error: insertError } = await supabase
                        .from('profiles')
                        .insert([newUserProfile])
                        .select()
                        .single();
                    
                    if (insertError) throw insertError;
                    if (newProfile) setCurrentUser({ ...newProfile, email: user.email, language: newProfile.ai_profile_info?.language || 'English' });
                }
            } catch (e) {
                console.error("Error fetching/hydrating user profile:", e);
            } finally {
                const consent = localStorage.getItem('cookieConsent');
                if (consent !== 'true') {
                    setShowCookieConsent(true);
                }
            }
        };
        fetchAndHydrateProfile();
    }
  }, [currentUserId]);
  
  // Chat history listener
  useEffect(() => {
    if (!currentUserId) {
        setChatHistory([initialMessage]);
        return;
    }

    const fetchHistory = async () => {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('user_id', currentUserId)
            .order('created_at', { ascending: true });
        
        if (error) {
            console.error('Error fetching chat history:', error);
        } else if (data) {
            if (data.length === 0) {
                 setChatHistory([{ role: 'model', content: "Welcome! I'm Padi. Let's have a chat." }]);
            } else {
                setChatHistory(data);
            }
        }
    };

    fetchHistory();

    const handleRealtimeUpdate = (payload: any) => {
      if (payload.eventType === 'INSERT') {
          const newMessage = payload.new as ChatMessage;
          setChatHistory(prev => {
              if (prev.find(msg => msg.id === newMessage.id)) return prev;
              return [...prev, newMessage];
          });
      } else if (payload.eventType === 'UPDATE') {
          const updatedMessage = payload.new as ChatMessage;
          setChatHistory(prev => prev.map(msg => msg.id === updatedMessage.id ? updatedMessage : msg));
      }
    };

    const channel = supabase.channel(`messages-for-${currentUserId}`)
        .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'messages', 
            filter: `user_id=eq.${currentUserId}` 
        },
        handleRealtimeUpdate)
        .subscribe((status, err: any) => {
          if (status === 'CHANNEL_ERROR') {
            console.error('Realtime channel error:', err?.message || err);
          }
        });
    
    return () => {
        supabase.removeChannel(channel).catch(console.error);
    };
  }, [currentUserId]);


  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };
  
  const handleClearHistory = async () => {
    if (!currentUser) return;
    try {
        const { error } = await supabase.from('messages').delete().eq('user_id', currentUser.id);
        if (error) throw error;
        setChatHistory([{ role: 'model', content: "Welcome! I'm Padi. Let's have a chat." }]);
    } catch (error) {
        console.error("Error clearing history: ", error);
    }
  };
  
  const addMessages = useCallback(async (messages: Omit<ChatMessage, 'user_id'>[]): Promise<ChatMessage[]> => {
    if (!currentUser) return [];
    
    const messagesToInsert = messages.map(msg => ({ ...msg, user_id: currentUser.id }));

    try {
      const { data, error } = await supabase.from('messages').insert(messagesToInsert).select();
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Error adding messages:", error);
      return [];
    }
  }, [currentUser]);

  const updateStreamedMessage = useCallback(async (id: string, content: string) => {
      if (!currentUser || !id) return;
      try {
          const { error } = await supabase.from('messages').update({ content }).eq('id', id);
          if (error) throw error;
      } catch (error) {
          console.error("Error updating streamed message:", error);
      }
  }, [currentUser]);


  const deductPoints = useCallback(async (amount: number) => {
    if (!currentUser || currentUser.is_admin) return true;
    if (currentUser.points < amount) {
      alert("You don't have enough points for this action. Please upgrade your plan.");
      setIsPricingModalOpen(true);
      return false;
    }

    const newPoints = currentUser.points - amount;
    setCurrentUser({ ...currentUser, points: newPoints });

    const { error } = await supabase
        .from('profiles')
        .update({ points: newPoints })
        .eq('id', currentUser.id);

    if (error) {
        console.error("Error deducting points: ", error);
        setCurrentUser(prev => prev ? { ...prev, points: prev.points + amount } : null);
        return false;
    }
    return true;
  }, [currentUser]);

  const handleStartCheckout = (tier: TierInfo) => {
    setSelectedTierForCheckout(tier);
    setIsPricingModalOpen(false);
    setIsCheckoutOpen(true);
  };

  const handleCheckoutSuccess = async (tier: SubscriptionTier, points: number) => {
    if (currentUser) {
      try {
        const newTotalPoints = currentUser.points + points;
        const { data, error } = await supabase
            .from('profiles')
            .update({ tier, points: newTotalPoints })
            .eq('id', currentUser.id)
            .select()
            .single();

        if (error) throw error;

        setCurrentUser(prev => prev ? { ...prev, tier: data.tier, points: data.points } : null);
        setIsCheckoutOpen(false);
      } catch (error) {
        console.error("Error updating subscription:", error);
      }
    }
  };
  
  const addToBasket = async (content: string) => {
    if (!currentUser || currentUser.basket_items.includes(content)) return;
    
    const updatedBasket = [...currentUser.basket_items, content];

    try {
        const { error } = await supabase.from('profiles').update({ basket_items: updatedBasket }).eq('id', currentUser.id);
        if (error) throw error;
        setCurrentUser(prev => prev ? { ...prev, basket_items: updatedBasket } : null);
    } catch (error) {
        console.error("Error adding to basket:", error);
    }
  };

  const removeFromBasket = async (index: number) => {
    if (!currentUser) return;
    const updatedBasket = currentUser.basket_items.filter((_, i) => i !== index);

    try {
      const { error } = await supabase.from('profiles').update({ basket_items: updatedBasket }).eq('id', currentUser.id);
      if (error) throw error;
      setCurrentUser(prev => prev ? { ...prev, basket_items: updatedBasket } : null);
    } catch (error) {
      console.error("Error removing from basket:", error);
    }
  };
  
  const updateAiProfileInfo = async (updatedProfile: AiProfileInfo) => {
    if (!currentUser) return;
    try {
        const newProfileInfo = {
            ...currentUser.ai_profile_info,
            ...updatedProfile
        };

        const { data, error } = await supabase
            .from('profiles')
            .update({ ai_profile_info: newProfileInfo })
            .eq('id', currentUser.id)
            .select()
            .single();
        
        if (error) throw error;

        if (data) {
            setCurrentUser(prev => prev ? { ...prev, ai_profile_info: data.ai_profile_info, language: data.ai_profile_info.language || 'English' } : null);
        }
    } catch (error) {
        console.error("Error updating AI profile:", error);
    }
  };
  
  const updateLanguage = async (newLanguage: string) => {
    if (!currentUser) return;
    try {
        const updatedProfileInfo = { ...currentUser.ai_profile_info, language: newLanguage };
        const { data, error } = await supabase
            .from('profiles')
            .update({ ai_profile_info: updatedProfileInfo })
            .eq('id', currentUser.id)
            .select()
            .single();
        
        if (error) throw error;

        if (data) {
            setCurrentUser(prev => prev ? { ...prev, ai_profile_info: data.ai_profile_info, language: data.ai_profile_info.language || 'English' } : null);
        }
    } catch (error) {
        console.error("Error updating language:", error);
    }
  };

  const handleAcceptCookies = () => {
    localStorage.setItem('cookieConsent', 'true');
    setShowCookieConsent(false);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gemini-dark-bg flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!currentUser) {
    return <Auth />;
  }

  const renderContent = () => {
    const commonProps = {
      chatHistory,
      aiProfileInfo: currentUser.ai_profile_info,
      addToBasket,
      deductPoints,
      currentUser,
      language: currentUser.language,
    };
    switch (activeTab) {
      case 'live':
        return <LiveConversation {...commonProps} addMessages={addMessages} cost={POINTS_CONFIG.liveConversationStart} />;
      case 'tts':
        return <TextToSpeech chatHistory={chatHistory} deductPoints={deductPoints} charCost={POINTS_CONFIG.textToSpeechChar} />;
      case 'chat':
        return <LowLatencyChat {...commonProps} addMessages={addMessages} updateStreamedMessage={updateStreamedMessage} cost={POINTS_CONFIG.lowLatencyMessage} />;
      default:
        return <LiveConversation {...commonProps} addMessages={addMessages} cost={POINTS_CONFIG.liveConversationStart} />;
    }
  };

  return (
    <div className="min-h-screen bg-gemini-dark-bg flex flex-col items-center p-4 font-sans">
      <div className="w-full max-w-4xl mx-auto">
        <Header 
          activeTab={activeTab} 
          setActiveTab={setActiveTab} 
          onClearHistory={handleClearHistory}
          hasHistory={chatHistory.length > 1 || (chatHistory.length === 1 && chatHistory[0].content !== "Welcome! I'm Padi. Let's have a chat.")}
          basketItemCount={currentUser.basket_items.length}
          onToggleBasket={() => setIsBasketOpen(!isBasketOpen)}
          currentUser={currentUser}
          onLogout={handleLogout}
          onUpgrade={() => setIsPricingModalOpen(true)}
          language={currentUser.language}
          onUpdateLanguage={updateLanguage}
        />
        <main className="mt-6">
          {renderContent()}
        </main>
      </div>
      <Basket 
        isOpen={isBasketOpen}
        onClose={() => setIsBasketOpen(false)}
        basketItems={currentUser.basket_items}
        aiProfileInfo={currentUser.ai_profile_info}
        onRemoveItem={removeFromBasket}
        onUpdateProfile={updateAiProfileInfo}
      />
      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
        currentUser={currentUser}
        onStartCheckout={handleStartCheckout}
      />
      {selectedTierForCheckout && (
        <BitPayCheckout
            isOpen={isCheckoutOpen}
            onClose={() => setIsCheckoutOpen(false)}
            tier={selectedTierForCheckout}
            onSuccess={handleCheckoutSuccess}
        />
      )}
      <CookieConsent isOpen={showCookieConsent} onAccept={handleAcceptCookies} />
    </div>
  );
};

export default App;
