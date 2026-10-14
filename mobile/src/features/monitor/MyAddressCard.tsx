import { useState } from 'react'
import { View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { PublicUser } from '@/api/types'
import { AddressText } from '@/components/AddressText'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { BottomSheet } from '@/components/Dialogs'
import { HomeAddressInputs, homeAddressBody, homeAddressOf } from '@/components/HomeAddressInputs'
import { ActionError, messageFor } from '@/components/States'
import { Text } from '@/components/Text'
import { useColors } from '@/theme/theme'

// The monitor's own home address (GET / PATCH /users/me): where their driver picks them up before
// the first student stop. Same key as the website's account page.
export function MyAddressCard() {
  const colors = useColors()
  const query = useQuery({ queryKey: ['account-me'], queryFn: () => api.get<PublicUser>('/users/me') })
  const [editing, setEditing] = useState(false)
  const account = query.data

  return (
    <>
      <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16, gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text size={12} color={colors.muted}>
            Your pickup address
          </Text>
          {account ? <Button label="Edit" variant="outline" compact onPress={() => setEditing(true)} /> : null}
        </View>
        {account?.home_address ? (
          <AddressText address={account.home_address} size={15} />
        ) : (
          <Text size={14} color={colors.muted}>
            {query.isLoading ? 'Loading…' : 'Not set. Add it so your driver knows where to pick you up.'}
          </Text>
        )}
      </Card>
      {editing && account ? <EditAddressSheet account={account} onClose={() => setEditing(false)} /> : null}
    </>
  )
}

function EditAddressSheet({ account, onClose }: { account: PublicUser; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [address, setAddress] = useState(homeAddressOf(account))
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => api.patch<PublicUser>('/users/me', homeAddressBody(address)),
    onMutate: () => setError(null),
    onSuccess: (a) => {
      queryClient.setQueryData(['account-me'], a)
      onClose()
    },
    onError: (err) => setError(messageFor(err, 'Could not save your address.')),
  })
  return (
    <BottomSheet
      label="Edit your pickup address"
      onClose={onClose}
      header={
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
          <Text size={18} weight="semibold">
            Your pickup address
          </Text>
        </View>
      }
    >
      <HomeAddressInputs label="Your driver picks you up here" value={address} onChange={setAddress} />
      {error ? <ActionError message={error} /> : null}
      <Button label="Save" busy={save.isPending} busyLabel="Saving…" onPress={() => save.mutate()} />
    </BottomSheet>
  )
}
